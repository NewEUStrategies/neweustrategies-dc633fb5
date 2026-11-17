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
// MIARA POZA BRAMKĄ (`SeamFacts.observed`, `renderObservedQueries`,
// `generate:ts-sql-contract --measure`). Dwie luki tej bramki są dziś
// MIERZONE, a nie egzekwowane - wynik nie trafia do pgTAP ani do
// `check:ts-sql-contract`:
//   * kolumny filtrów i sortowania (`.eq/.in/.or("a.eq.x")/.match/.order`...).
//     Postgres wymaga SELECT na kolumnie z WHERE/ORDER BY także w UPDATE
//     i DELETE, więc filtr po kolumnie bez grantu daje 42501 tak samo jak
//     odczyt (listopad 2026: `user_reports.reporter_id` w eksporcie RODO,
//     `profiles.current_company_id` w karcie firmy CRM);
//   * rola klienta szerzej niż reguły bramki: fabryki klienta serwisowego
//     (`await admin()`), `createClient(…, klucz)`, `const x = ...`
//     i parametr klienta - przez WSZYSTKIE wywołania funkcji (inaczej
//     `unknown`; nigdy zgadywanie).
// Fakt bramki zachowuje swoją rolę (`enforcedRole`), więc wygenerowany
// pgTAP jest bajt w bajt ten sam co bez miary.
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
  /** Miara poza bramką (filtry, rola szerzej) - nie wpływa na pgTAP ani na zasięg. */
  readonly observed: ObservedFacts;
}

// ── Miara poza bramką: typy ─────────────────────────────────────────────────

/** Rola zmierzona: jak `ClientRole`, plus `anon` z klienta z kluczem publicznym. */
export type MeasuredRole = ClientRole | "anon";

export interface RoleResolution {
  readonly role: MeasuredRole;
  /** Jak rozstrzygnięto rolę: reguła bramki (`bramka: ...`) albo łańcuch miary. */
  readonly via: string;
  /**
   * Wartość nigdy nie jest podana (parametr pomijany we WSZYSTKICH
   * wywołaniach) - nie niesie klienta, więc nie wpływa na zgodność ról.
   */
  readonly absent?: boolean;
}

interface ObservedCommon {
  readonly role: MeasuredRole;
  readonly via: string;
  /** Rola, z którą ten fakt idzie do pgTAP (`unknown` = uprawnień bramka nie sprawdza). */
  readonly enforcedRole: ClientRole;
  /** Plik wywołania (`file` faktu bywa plikiem literału kolumn). */
  readonly site: string;
  /** Ścieżka nazwanych funkcji wywołania (jak w kluczach list przejrzanych). */
  readonly fn: string;
}

export interface ObservedRpc extends ObservedCommon {
  readonly name: string;
  readonly keys: readonly string[] | null;
  readonly file: string;
}

export interface ObservedTable extends ObservedCommon {
  readonly table: string;
  readonly op: TableOp;
  readonly columns: readonly string[];
  readonly star: boolean;
  readonly file: string;
}

/** Kolumna filtra albo sortowania: rola potrzebuje SELECT na `table.column`. */
export interface FilterSite extends ObservedCommon {
  /** Tabela kolumny - przy filtrze zasobu osadzonego tabela osadzona. */
  readonly table: string;
  readonly column: string;
  /** Ścieżka osadzenia (`slot`, `a.b`); `null` - kolumna tabeli z `.from()`. */
  readonly embed: string | null;
  /** Metoda budowniczego (`eq`, `or`, `match`, `order`, ...). */
  readonly method: string;
  /** Operacja łańcucha (filtr UPDATE/DELETE też wymaga SELECT). */
  readonly op: TableOp;
  /** Plik, w którym rozwiązał się literał kolumny. */
  readonly file: string;
}

/**
 * Zapytanie jednego łańcucha budowniczego (łańcuch wprost i - gdy budowniczy
 * trafia do zmiennej - każde jej użycie) do SONDY WYKONANIA miary: sonda
 * wykonuje je jako rola zmierzona (`SELECT … LIMIT 0`, zapis jako `EXPLAIN`),
 * więc łapie odmowę uprawnień WEWNĄTRZ relacji (widok `security_invoker`,
 * podzapytanie polityki RLS), której `has_column_privilege` na samej relacji
 * nie widzi.
 */
export interface ObservedStatement {
  readonly table: string;
  readonly op: TableOp;
  readonly role: MeasuredRole;
  readonly via: string;
  readonly site: string;
  readonly fn: string;
  /** Kolumny `select` - przy zapisie lista RETURNING; `star` - `*`. */
  readonly columns: readonly string[];
  readonly star: boolean;
  /** Kolumny ładunku INSERT/UPDATE/upsert; `[]` przy odczycie i DELETE. */
  readonly payload: readonly string[];
  /** Kolumny filtrów i sortowania tabeli łańcucha (bez osadzeń) - UPDATE, DELETE i odczyt. */
  readonly where: readonly string[];
  /**
   * Cel `ON CONFLICT` upsertu (`PRIMARY_KEY_COLUMNS` - klucz główny, `[]` - cel
   * nieczytelny); `null` - nie upsert.
   */
  readonly conflict: readonly string[] | null;
}

export interface ObservedFacts {
  /** Każdy fakt RPC bramki z rolą zmierzoną (ta sama kolejność co `rpcs`). */
  readonly rpcs: readonly ObservedRpc[];
  /** Każdy fakt tabeli bramki (także wstrzymany) z rolą zmierzoną. */
  readonly tables: readonly ObservedTable[];
  readonly filters: readonly FilterSite[];
  /** Zapytania łańcuchów `.from()`/`looseTable` do sond wykonania (bez powtórzeń). */
  readonly statements: readonly ObservedStatement[];
  /**
   * Filtry na rozpoznanym budowniczym, których kolumny (albo tabeli
   * osadzenia) nie da się ustalić statycznie, oraz filtry budowniczego
   * z tabelą nieczytelną. Posortowane.
   */
  readonly unresolvedFilters: readonly string[];
  /**
   * Wywołania w kształcie filtra PostgREST na odbiorcy, którego ekstrakcja
   * nie wiąże z żadnym budowniczym (parametr pomocnika `q`, wynik funkcji) -
   * kolumny nieobjęte miarą. Szacunek po kształcie wywołania. Posortowane.
   */
  readonly filtersOutsideChains: readonly string[];
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

// ── Miara poza bramką: rola klienta szerzej ─────────────────────────────────
//
// Reguły bramki (`receiverRole`) rozstrzygają rolę po NAZWIE odbiorcy; reszta
// (535 faktów w listopadzie 2026: parametr `supabase: SupabaseClient`,
// `await admin()`, `rpcClient(admin)`, `const db = await adminClient(x)`)
// to `unknown`. Miara idzie dalej, ale tylko tam, gdzie wartość odbiorcy
// wynika z kodu bez zgadywania:
//   * `const x = E` (albo `let` bez przypisań), jedyne wiązanie nazwy w swojej
//     funkcji, a użycie w bloku deklaracji - rola `E`; `const { p } = E` -
//     rola `E.p`;
//   * wywołanie funkcji tego pliku albo importu nazwanego (także
//     `const { f } = await import(...)`) - KAŻDY `return` daje tę samą rolę;
//     `return parametr` (także `parametr.p`, `a ?? b`) to argument TEGO
//     wywołania, a `return null` albo pominięty argument - brak klienta,
//     czyli brak zapytania;
//   * `createClient(url, process.env.*SERVICE_ROLE*)` - `service_role`; klucz
//     publiczny (`*PUBLISHABLE*`, `*ANON*`) - `anon`, a z nagłówkiem
//     `Authorization` w opcjach - `authenticated` (token z żądania);
//     opcje nieczytelne - `unknown`;
//   * import `supabaseAdmin` z `client.server` - `service_role`; import
//     `supabase` z `client` - `authenticated` (ta sama umowa co w bramce);
//   * parametr funkcji (także `opts.supabase` i `{ supabase }`) - przez
//     WSZYSTKIE wywołania: każde odwołanie do nazwy funkcji w jej bloku
//     i w plikach importujących to wywołanie wprost (nie wartość, nie
//     `export { f }`), moduł nie ma importu przestrzeni nazw, reeksportu ani
//     `import()` bez rozkładu, a role argumentów wszystkich wywołań są równe.
// Wszystko inne - `unknown` z powodem w `via`. Najwyżej `ROLE_FLOW_MAX_DEPTH`
// skoków; cykl - `unknown`.

/** Najwięcej skoków (stała, parametr, fabryka) między odbiorcą a klientem. */
export const ROLE_FLOW_MAX_DEPTH = 6;

/** Moduły klienta, których eksport nie jest zwykłą stałą (Proxy). */
const KNOWN_CLIENT_EXPORTS: readonly {
  readonly module: string;
  readonly name: string;
  readonly role: ClientRole;
  readonly via: string;
}[] = [
  {
    module: "src/integrations/supabase/client.server.ts",
    name: "supabaseAdmin",
    role: "service_role",
    via: "import supabaseAdmin",
  },
  {
    module: "src/integrations/supabase/client.ts",
    name: "supabase",
    role: "authenticated",
    via: "import klienta przeglądarki",
  },
];

interface CallSite {
  readonly call: ts.CallExpression;
  readonly scope: FileScope;
}

/** Odwołanie do modułu spoza importu nazwanego (przestrzeń nazw, reeksport, `import()`). */
interface ModuleRef {
  readonly scope: FileScope;
  readonly node: ts.Node;
}

interface RoleEnv {
  readonly flow: FlowEnv;
  /** Plik -> odwołania spoza importów nazwanych; budowane leniwie. */
  moduleRefs: Map<string, ModuleRef[]> | null;
  readonly memo: Map<string, RoleResolution>;
  readonly sites: Map<ts.Node, readonly CallSite[] | null>;
  /** Licznik cięć głębokości - wynik z cięciem nie trafia do `memo`. */
  depthCuts: number;
}

const MAX_VIA = 400;

function unknownRole(via: string): RoleResolution {
  return { role: "unknown", via: via.slice(0, MAX_VIA) };
}

function compactText(node: ts.Node, scope: FileScope, max = 60): string {
  return node.getText(scope.sf).replace(/\s+/g, " ").slice(0, max);
}

/** Opis reguły bramki, która dała rolę (lustro gałęzi `receiverRole`). */
function legacyRoleVia(receiver: ts.Expression, scope: FileScope): string {
  const node = unwrap(receiver);
  if (ts.isIdentifier(node)) {
    if (scope.adminAliases.has(node.text)) {
      return node.text === "supabaseAdmin" ? "supabaseAdmin" : `${node.text} = supabaseAdmin`;
    }
    if (node.text === "supabase") {
      return scope.browserClient ? "klient przeglądarki" : "plik z requireSupabaseAuth";
    }
  }
  return compactText(node, scope);
}

/** Wspólna rola wartości; różne albo nieznane - `unknown` z powodem. */
function agreeingRole(label: string, all: readonly RoleResolution[]): RoleResolution {
  const roles = all.filter((r) => r.absent !== true);
  if (roles.length === 0) {
    return { ...unknownRole(`${label}: żadna wartość nie niesie klienta`), absent: all.length > 0 };
  }
  const distinct = [...new Set(roles.map((r) => r.role))];
  if (distinct.length !== 1 || distinct[0] === "unknown") {
    const first = roles.find((r) => r.role === "unknown");
    return unknownRole(
      `${label}: role [${distinct.join(", ")}]${first === undefined ? "" : ` - ${first.via}`}`,
    );
  }
  const vias = [...new Set(roles.map((r) => r.via))];
  return { role: distinct[0], via: `${label} <- ${vias.join(" | ")}`.slice(0, MAX_VIA) };
}

/** Rola zmierzona: reguła bramki, a gdy ta daje `unknown` - reguły miary. */
function measuredRole(
  expr: ts.Expression,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  const legacy = receiverRole(expr, scope, env.flow.known);
  if (legacy !== "unknown") {
    const node = unwrap(expr);
    // Reguła NAZWY `supabase` (plik z klientem przeglądarki albo
    // z `requireSupabaseAuth`) nie patrzy na wiązanie: parametr albo zmienna
    // lokalna o tej nazwie może nieść innego klienta (menu: parametr
    // z domyślnym `serverPublicClient()` - klucz publiczny, czyli `anon`).
    // Nazwa zadeklarowana w pliku (parametr - także z wartością domyślną,
    // rozkładany, element rozkładu - `const`, `let`, `var`, zmienna pętli
    // albo `catch`) - rozstrzyga wiązanie: INNA rola wygrywa (rozjazd
    // z `enforcedRole`), a nieustalona daje `unknown`, bo reguła nazwy to
    // wtedy zgadywanie. Import (także `import("m").then(({ supabase }) => ...)`)
    // z ustaloną INNĄ rolą modułu wygrywa; nieustalony i nazwa bez deklaracji -
    // reguła bramki.
    if (ts.isIdentifier(node) && node.text === "supabase" && !scope.adminAliases.has("supabase")) {
      const binding = bindingOf(node, scope);
      if (binding.kind === "import") {
        const imported = identifierRole(node, scope, env, depth);
        if (imported.role !== "unknown" && imported.role !== legacy) {
          return {
            role: imported.role,
            via: `wiązanie zamiast reguły nazwy (bramka: ${legacy}): ${imported.via}`.slice(
              0,
              MAX_VIA,
            ),
          };
        }
      }
      const declaredInFile =
        binding.kind === "param" ||
        binding.kind === "defaulted" ||
        binding.kind === "local" ||
        binding.kind === "reassigned" ||
        binding.kind === "function" ||
        (binding.kind === "none" && declaringScope(node) !== null);
      if (declaredInFile) {
        const bound = identifierRole(node, scope, env, depth);
        if (bound.role === "unknown") {
          return bound.absent === true
            ? bound
            : unknownRole(`reguła nazwy nie zgaduje (bramka: ${legacy}): ${bound.via}`);
        }
        if (bound.role !== legacy) {
          return {
            role: bound.role,
            via: `wiązanie zamiast reguły nazwy (bramka: ${legacy}): ${bound.via}`.slice(
              0,
              MAX_VIA,
            ),
          };
        }
      }
    }
    return { role: legacy, via: `bramka: ${legacyRoleVia(expr, scope)}` };
  }
  if (depth > ROLE_FLOW_MAX_DEPTH) {
    env.depthCuts += 1;
    return unknownRole(`przepływ roli dłuższy niż ${ROLE_FLOW_MAX_DEPTH} skoków`);
  }
  const node = unwrap(expr);
  if (ts.isCallExpression(node)) return callRole(node, scope, env, depth);
  if (ts.isIdentifier(node)) return identifierRole(node, scope, env, depth);
  if (ts.isPropertyAccessExpression(node)) {
    return memberRole(node.expression, node.name.text, scope, env, depth);
  }
  if (ts.isConditionalExpression(node)) {
    return agreeingRole(
      "warunek",
      [node.whenTrue, node.whenFalse].map((b) => measuredRole(b, scope, env, depth + 1)),
    );
  }
  return unknownRole(`wyrażenie ${compactText(node, scope)}`);
}

type Binding =
  | {
      readonly kind: "param";
      readonly fn: ts.SignatureDeclaration;
      readonly index: number;
      readonly prop: string | null;
    }
  | {
      /**
       * Parametr-identyfikator z wartością domyślną: wartość domyślna działa,
       * gdy argument pominięto (albo podano `undefined`).
       */
      readonly kind: "defaulted";
      readonly fn: ts.SignatureDeclaration;
      readonly index: number;
      readonly init: ts.Expression;
    }
  | { readonly kind: "local"; readonly init: ts.Expression; readonly prop: string | null }
  | {
      /** `let` przypisywany wyłącznie `nazwa = E`: inicjalizator i każda prawa strona. */
      readonly kind: "reassigned";
      readonly decl: ts.VariableDeclaration;
      readonly values: readonly ts.Expression[];
    }
  | { readonly kind: "function"; readonly fn: ts.SignatureDeclaration }
  | { readonly kind: "import"; readonly module: string; readonly name: string }
  | { readonly kind: "none"; readonly why: string };

function noBinding(why: string): Binding {
  return { kind: "none", why };
}

/** `import("spec")` (bez owijek) - specyfikator albo `null`. */
function dynamicImportSpec(expr: ts.Expression): string | null {
  const node = unwrap(expr);
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length >= 1 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    return node.arguments[0].text;
  }
  return null;
}

/** Callback `import("spec").then(cb)` (pierwszy argument) - specyfikator albo `null`. */
function dynamicImportThenSpec(fn: ts.Node): string | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const outer = outermostWrapper(fn);
  const call = outer.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== outer) return null;
  const callee = unwrap(call.expression);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "then"
    ? dynamicImportSpec(callee.expression)
    : null;
}

/** Czy wzorzec rozkładu wiąże nazwę (na dowolnej głębokości). */
function patternBinds(name: ts.BindingName, target: string): boolean {
  if (ts.isIdentifier(name)) return name.text === target;
  return name.elements.some((el) => !ts.isOmittedExpression(el) && patternBinds(el.name, target));
}

/**
 * Deklaracje nazwy WPROST w zasięgu blokowym (instrukcje bloku, pliku albo
 * `case`), bez bloków i funkcji zagnieżdżonych: zmienna (także element
 * rozkładu), funkcja, klasa, enum, import.
 */
function directDeclarations(container: ts.Node, name: string): ts.Node[] {
  const statements = ts.isCaseBlock(container)
    ? container.clauses.flatMap((c) => [...c.statements])
    : ts.isSourceFile(container) || ts.isBlock(container) || ts.isModuleBlock(container)
      ? [...container.statements]
      : [];
  const out: ts.Node[] = [];
  const fromPattern = (decl: ts.VariableDeclaration): void => {
    if (ts.isIdentifier(decl.name)) {
      if (decl.name.text === name) out.push(decl);
      return;
    }
    const walk = (pattern: ts.BindingPattern): void => {
      for (const el of pattern.elements) {
        if (ts.isOmittedExpression(el)) continue;
        if (ts.isIdentifier(el.name)) {
          if (el.name.text === name) out.push(el);
        } else walk(el.name);
      }
    };
    walk(decl.name);
  };
  for (const stmt of statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) fromPattern(decl);
    } else if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === name
    ) {
      out.push(stmt);
    } else if (ts.isImportDeclaration(stmt) && stmt.importClause !== undefined) {
      const clause = stmt.importClause;
      if (clause.name?.text === name) out.push(clause);
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named) && named.name.text === name) {
        out.push(named);
      }
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const el of named.elements) if (el.name.text === name) out.push(el);
      }
    }
  }
  return out;
}

/** Czy w ciele funkcji (bez funkcji zagnieżdżonych) jest `var` tej nazwy - wynoszony poza blok. */
function hasVarDeclaration(fn: ts.SignatureDeclaration, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== fn && ts.isFunctionLike(node))) return;
    if (
      ts.isVariableDeclarationList(node) &&
      !(node.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) &&
      node.declarations.some((d) => patternBinds(d.name, name))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

/**
 * Zasięg, który deklaruje nazwę widzianą z identyfikatora (blok, plik,
 * funkcja z parametrem, pętla, `catch`); `null` - nazwa globalna.
 */
function declaringScope(id: ts.Identifier): ts.Node | null {
  const name = id.text;
  for (let node: ts.Node = id; node.parent !== undefined; node = node.parent) {
    const parent = node.parent;
    if (
      (ts.isSourceFile(parent) ||
        ts.isBlock(parent) ||
        ts.isModuleBlock(parent) ||
        ts.isCaseBlock(parent)) &&
      directDeclarations(parent, name).length > 0
    ) {
      return parent;
    }
    if (ts.isFunctionLike(parent) && parent.parameters.some((p) => patternBinds(p.name, name))) {
      return parent;
    }
    if (
      ((ts.isForStatement(parent) || ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
        parent.initializer !== undefined &&
        ts.isVariableDeclarationList(parent.initializer) &&
        parent.initializer.declarations.some((d) => patternBinds(d.name, name))) ||
      (ts.isCatchClause(parent) &&
        parent.variableDeclaration !== undefined &&
        patternBinds(parent.variableDeclaration.name, name))
    ) {
      return parent;
    }
  }
  return null;
}

/**
 * Prawe strony przypisań `nazwa = E` (także `??=`, `||=`) do zmiennej
 * zadeklarowanej WPROST w `root` - przypisania do innej zmiennej o tej samej
 * nazwie (przesłonięcie w bloku wewnętrznym) się nie liczą. `null` - inna
 * mutacja (`+=`, `++`, rozkład, `for (nazwa of ...)`).
 */
function simpleAssignments(root: ts.Node, name: string): ts.Expression[] | null {
  const values: ts.Expression[] = [];
  let simple = true;
  const ours = (id: ts.Identifier): boolean => declaringScope(id) === root;
  const mentions = (node: ts.Node): boolean => {
    let found = false;
    const visit = (child: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(child) && child.text === name && ours(child)) found = true;
      else ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  const visit = (node: ts.Node): void => {
    if (!simple) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const left = unwrap(node.left);
      if (ts.isIdentifier(left) && left.text === name && ours(left)) {
        // `x ??= E` i `x ||= E` - x to poprzednia wartość albo E.
        const kind = node.operatorToken.kind;
        if (
          kind === ts.SyntaxKind.EqualsToken ||
          kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
          kind === ts.SyntaxKind.BarBarEqualsToken
        ) {
          values.push(node.right);
        } else simple = false;
      } else if (
        (ts.isArrayLiteralExpression(left) || ts.isObjectLiteralExpression(left)) &&
        mentions(left)
      ) {
        simple = false;
      }
    }
    if (
      ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        mentions(node.operand)) ||
      ((ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer) &&
        mentions(node.initializer))
    ) {
      simple = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return simple ? values : null;
}

/** Wiązanie z deklaracji znalezionej w zasięgu `container`. */
function declarationBinding(decl: ts.Node, container: ts.Node, name: string): Binding {
  if (ts.isFunctionDeclaration(decl)) {
    return isAssigned(container, name)
      ? noBinding(`${name}: funkcja przypisana`)
      : { kind: "function", fn: decl };
  }
  if (ts.isImportSpecifier(decl)) {
    const spec = decl.parent.parent.parent.moduleSpecifier;
    return ts.isStringLiteral(spec)
      ? { kind: "import", module: spec.text, name: (decl.propertyName ?? decl.name).text }
      : noBinding(`${name}: import nieczytelny`);
  }
  if (ts.isVariableDeclaration(decl)) {
    const list = decl.parent;
    if (!ts.isVariableDeclarationList(list)) return noBinding(`${name}: deklaracja poza regułą`);
    if (list.flags & ts.NodeFlags.Const) {
      return decl.initializer === undefined
        ? noBinding(`${name}: const bez wartości`)
        : { kind: "local", init: decl.initializer, prop: null };
    }
    if (!(list.flags & ts.NodeFlags.Let)) return noBinding(`${name}: var`);
    const assigned = simpleAssignments(container, name);
    if (assigned === null) return noBinding(`${name}: let z mutacją inną niż \`=\``);
    if (assigned.length === 0) {
      return decl.initializer === undefined
        ? noBinding(`${name}: let bez wartości`)
        : { kind: "local", init: decl.initializer, prop: null };
    }
    return {
      kind: "reassigned",
      decl,
      values: decl.initializer === undefined ? assigned : [decl.initializer, ...assigned],
    };
  }
  if (ts.isBindingElement(decl)) {
    const pattern = decl.parent;
    const vd = pattern.parent;
    if (
      !ts.isObjectBindingPattern(pattern) ||
      !ts.isVariableDeclaration(vd) ||
      vd.initializer === undefined ||
      decl.dotDotDotToken !== undefined ||
      decl.initializer !== undefined ||
      !ts.isVariableDeclarationList(vd.parent) ||
      !(vd.parent.flags & ts.NodeFlags.Const)
    ) {
      return noBinding(`${name}: element rozkładu poza regułą`);
    }
    const prop = decl.propertyName ? propName(decl.propertyName) : name;
    if (prop === null) return noBinding(`${name}: klucz rozkładu obliczany`);
    const spec = dynamicImportSpec(vd.initializer);
    return spec !== null
      ? { kind: "import", module: spec, name: prop }
      : { kind: "local", init: vd.initializer, prop };
  }
  return noBinding(`${name}: deklaracja ${ts.SyntaxKind[decl.kind]}`);
}

/**
 * Wiązanie identyfikatora według zasięgów leksykalnych: najbliższy blok
 * (albo funkcja - parametry), który deklaruje nazwę WPROST. Parametr
 * przypisywany, `var`, zmienna pętli albo `catch` - poza regułą.
 */
function bindingOf(id: ts.Identifier, _scope: FileScope): Binding {
  const name = id.text;
  for (let node: ts.Node = id; node.parent !== undefined; node = node.parent) {
    const parent = node.parent;
    if (
      ts.isSourceFile(parent) ||
      ts.isBlock(parent) ||
      ts.isModuleBlock(parent) ||
      ts.isCaseBlock(parent)
    ) {
      const decls = directDeclarations(parent, name);
      if (decls.length > 1) return noBinding(`${name}: kilka deklaracji w bloku`);
      if (decls.length === 1) return declarationBinding(decls[0], parent, name);
    } else if (ts.isFunctionLike(parent)) {
      if (hasVarDeclaration(parent, name)) return noBinding(`${name}: var w funkcji`);
      for (const [index, p] of parent.parameters.entries()) {
        if (!patternBinds(p.name, name)) continue;
        if (isAssigned(parent, name)) return noBinding(`${name}: parametr przypisywany`);
        if (ts.isIdentifier(p.name)) {
          if (p.dotDotDotToken) return noBinding(`${name}: parametr rozkładany`);
          return p.initializer
            ? { kind: "defaulted", fn: parent, index, init: p.initializer }
            : { kind: "param", fn: parent, index, prop: null };
        }
        const el = ts.isObjectBindingPattern(p.name)
          ? p.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === name)
          : undefined;
        const prop = el === undefined ? null : el.propertyName ? propName(el.propertyName) : name;
        if (
          el === undefined ||
          prop === null ||
          el.dotDotDotToken ||
          el.initializer ||
          p.dotDotDotToken
        ) {
          return noBinding(`${name}: element parametru poza regułą`);
        }
        // `import("m").then(({ x }) => ...)` - parametr to przestrzeń nazw
        // modułu, jak `const { x } = await import("m")`.
        const spec = index === 0 ? dynamicImportThenSpec(parent) : null;
        return spec !== null
          ? { kind: "import", module: spec, name: prop }
          : { kind: "param", fn: parent, index, prop };
      }
      if (ts.isFunctionExpression(parent) && parent.name?.text === name) {
        return noBinding(`${name}: nazwa wyrażenia funkcji`);
      }
    } else if (
      (ts.isForStatement(parent) || ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
      parent.initializer !== undefined &&
      ts.isVariableDeclarationList(parent.initializer) &&
      parent.initializer.declarations.some((d) => patternBinds(d.name, name))
    ) {
      return noBinding(`${name}: zmienna pętli`);
    } else if (
      ts.isCatchClause(parent) &&
      parent.variableDeclaration !== undefined &&
      patternBinds(parent.variableDeclaration.name, name)
    ) {
      return noBinding(`${name}: zmienna catch`);
    }
  }
  return noBinding(`${name}: brak wiązania w pliku`);
}

/** Eksport nazwany modułu: funkcja albo stała najwyższego poziomu. */
function moduleExport(
  spec: string,
  name: string,
  from: FileScope,
  env: RoleEnv,
): { readonly binding: Binding; readonly scope: FileScope } | null {
  const target = resolveModule(from.file, spec, env.flow.known);
  const scope = target === null ? undefined : env.flow.scopes.get(target);
  if (scope === undefined || bindingCount(scope.sf, name) !== 1 || isAssigned(scope.sf, name)) {
    return null;
  }
  for (const stmt of scope.sf.statements) {
    if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return { binding: { kind: "function", fn: stmt }, scope };
    }
    if (ts.isVariableStatement(stmt) && stmt.declarationList.flags & ts.NodeFlags.Const) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          return { binding: { kind: "local", init: decl.initializer, prop: null }, scope };
        }
      }
    }
  }
  return null;
}

function importRole(
  spec: string,
  name: string,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  const target = resolveModule(scope.file, spec, env.flow.known);
  const knownExport = KNOWN_CLIENT_EXPORTS.find((k) => k.module === target && k.name === name);
  if (knownExport !== undefined) return { role: knownExport.role, via: knownExport.via };
  const exported = moduleExport(spec, name, scope, env);
  if (exported === null || exported.binding.kind !== "local" || exported.binding.prop !== null) {
    return unknownRole(`import ${name} z ${spec}: nie stała modułu`);
  }
  const inner = measuredRole(exported.binding.init, exported.scope, env, depth + 1);
  return inner.role === "unknown"
    ? inner
    : { role: inner.role, via: `import ${name} <- ${inner.via}` };
}

function identifierRole(
  id: ts.Identifier,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  const binding = bindingOf(id, scope);
  switch (binding.kind) {
    case "param":
      return paramRole(binding.fn, binding.index, binding.prop, scope, env, depth);
    case "defaulted":
      return defaultedParamRole(binding.fn, binding.index, binding.init, scope, env, depth);
    case "local": {
      const inner =
        binding.prop === null
          ? measuredRole(binding.init, scope, env, depth + 1)
          : memberRole(binding.init, binding.prop, scope, env, depth + 1);
      return inner.role === "unknown"
        ? inner
        : { role: inner.role, via: `const ${id.text} <- ${inner.via}`.slice(0, MAX_VIA) };
    }
    case "reassigned":
      return agreeingRole(
        `let ${id.text} (${binding.values.length} wartości)`,
        binding.values.map((v) => measuredRole(v, scope, env, depth + 1)),
      );
    case "import":
      return importRole(binding.module, binding.name, scope, env, depth);
    case "function":
      return unknownRole(`${id.text}: funkcja, nie klient`);
    case "none":
      return unknownRole(binding.why);
  }
}

/** Rola `base.prop` (także `{ prop: X }` i parametr przekazujący obiekt dalej). */
function memberRole(
  base: ts.Expression,
  prop: string,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  const node = unwrap(base);
  // Te same reguły nazw co w bramce (`receiverRole`, `looseSourceRole`).
  if (prop === "supabaseAdmin") return { role: "service_role", via: "bramka: .supabaseAdmin" };
  if (
    prop === "supabase" &&
    ts.isIdentifier(node) &&
    (node.text === "context" || node.text === "ctx")
  ) {
    return { role: "authenticated", via: `bramka: ${node.text}.supabase` };
  }
  if (depth > ROLE_FLOW_MAX_DEPTH) {
    env.depthCuts += 1;
    return unknownRole(`przepływ roli dłuższy niż ${ROLE_FLOW_MAX_DEPTH} skoków`);
  }
  if (ts.isObjectLiteralExpression(node)) {
    let value: ts.Expression | null = null;
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) return unknownRole(`obiekt z rozkładem zamiast .${prop}`);
      if (ts.isPropertyAssignment(p) && propName(p.name) === prop) value = p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === prop) value = p.name;
    }
    return value === null
      ? unknownRole(`obiekt bez właściwości ${prop}`)
      : measuredRole(value, scope, env, depth + 1);
  }
  if (ts.isIdentifier(node)) {
    const binding = bindingOf(node, scope);
    if (binding.kind === "param" && binding.prop === null) {
      return paramRole(binding.fn, binding.index, prop, scope, env, depth);
    }
    if (binding.kind === "local" && binding.prop === null) {
      return memberRole(binding.init, prop, scope, env, depth + 1);
    }
    return unknownRole(
      `${node.text}.${prop}: ${binding.kind === "none" ? binding.why : `wiązanie ${binding.kind}`}`,
    );
  }
  return unknownRole(`.${prop} na ${compactText(node, scope)}`);
}

/** Rola źródła `looseTable(źródło, t)` / `looseClient(źródło)` - czyli `źródło.supabase`. */
function looseMeasuredRole(
  source: ts.Expression,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  const legacy = looseSourceRole(source, scope, env.flow.known);
  if (legacy !== "unknown") {
    return { role: legacy, via: `bramka: looseClient(${compactText(source, scope)})` };
  }
  return memberRole(source, "supabase", scope, env, depth);
}

/** Nazwa zmiennej środowiska klucza (`process.env.X`, przez stałe i `?? ""`). */
function envKeyOf(expr: ts.Expression | undefined, scope: FileScope, depth = 0): string | null {
  if (expr === undefined || depth > 6) return null;
  const node = unwrap(expr);
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const literal = (e: ts.Expression): boolean => ts.isStringLiteralLike(unwrap(e));
    if (literal(node.right)) return envKeyOf(node.left, scope, depth + 1);
    if (literal(node.left)) return envKeyOf(node.right, scope, depth + 1);
    const left = envKeyOf(node.left, scope, depth + 1);
    return left !== null && left === envKeyOf(node.right, scope, depth + 1) ? left : null;
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const base = node.expression.getText(scope.sf).replace(/\s+/g, "");
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    return key !== null && (base === "process.env" || base === "import.meta.env") ? key : null;
  }
  if (ts.isIdentifier(node)) {
    const binding = bindingOf(node, scope);
    return binding.kind === "local" && binding.prop === null
      ? envKeyOf(binding.init, scope, depth + 1)
      : null;
  }
  return null;
}

/** Czy opcje `createClient` mogą nieść nagłówek `Authorization`; `null` - nie wiadomo. */
function mayCarryAuthorization(
  expr: ts.Expression | undefined,
  path: readonly string[],
): boolean | null {
  if (expr === undefined) return false;
  const node = unwrap(expr);
  if (ts.isConditionalExpression(node)) {
    const a = mayCarryAuthorization(node.whenTrue, path);
    const b = mayCarryAuthorization(node.whenFalse, path);
    return a === null || b === null ? null : a || b;
  }
  if (!ts.isObjectLiteralExpression(node)) return null;
  let carries = false;
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) return null;
    const key = p.name === undefined ? null : propName(p.name as ts.PropertyName);
    if (key === null) {
      if (!ts.isMethodDeclaration(p)) return null;
      continue;
    }
    if (path.length === 0) {
      // `accessToken` (funkcja tokenu) na najwyższym poziomie opcji.
      if (key === "accessToken") carries = true;
    }
    if (path.length === 2 && key.toLowerCase() === "authorization") carries = true;
    const next = ["global", "headers"][path.length];
    if (key === next && ts.isPropertyAssignment(p)) {
      const inner = mayCarryAuthorization(p.initializer, [...path, key]);
      if (inner === null) return null;
      carries ||= inner;
    }
  }
  return carries;
}

/** `createClient` z `@supabase/supabase-js` (import statyczny albo `await import`). */
function isSupabaseCreateClient(callee: ts.Identifier, scope: FileScope): boolean {
  const binding = bindingOf(callee, scope);
  return (
    binding.kind === "import" &&
    binding.module === "@supabase/supabase-js" &&
    binding.name === "createClient"
  );
}

function createClientRole(call: ts.CallExpression, scope: FileScope): RoleResolution {
  const key = envKeyOf(call.arguments[1], scope);
  if (key === null) return unknownRole("createClient: klucz spoza process.env");
  if (/SERVICE_ROLE/.test(key)) return { role: "service_role", via: `createClient(…, ${key})` };
  if (/PUBLISHABLE|ANON/.test(key)) {
    const auth = mayCarryAuthorization(call.arguments[2], []);
    if (auth === null) return unknownRole(`createClient(…, ${key}): opcje nieczytelne`);
    return auth
      ? { role: "authenticated", via: `createClient(…, ${key}) z nagłówkiem Authorization` }
      : { role: "anon", via: `createClient(…, ${key})` };
  }
  return unknownRole(`createClient: klucz ${key}`);
}

/** Wyrażenia zwracane przez funkcję (bez funkcji zagnieżdżonych); `null` - bez ciała. */
function returnExpressions(fn: ts.SignatureDeclaration): ts.Expression[] | null {
  const body = (fn as ts.FunctionLikeDeclaration).body;
  if (body === undefined) return null;
  if (!ts.isBlock(body)) return [body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return out;
}

/** Możliwe wartości wyrażenia: gałęzie `a ?? b`, `a || b` i warunku. */
function alternativesOf(expr: ts.Expression): ts.Expression[] {
  const node = unwrap(expr);
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...alternativesOf(node.left), ...alternativesOf(node.right)];
  }
  if (ts.isConditionalExpression(node)) {
    return [...alternativesOf(node.whenTrue), ...alternativesOf(node.whenFalse)];
  }
  return [node];
}

/** Funkcja wołana po nazwie: deklaracja, `const f = () => ...` albo eksport importu. */
function calledFunction(
  callee: ts.Identifier,
  scope: FileScope,
  env: RoleEnv,
): { readonly fn: ts.SignatureDeclaration; readonly scope: FileScope } | null {
  let binding = bindingOf(callee, scope);
  let calleeScope = scope;
  if (binding.kind === "import") {
    const exported = moduleExport(binding.module, binding.name, scope, env);
    if (exported === null) return null;
    binding = exported.binding;
    calleeScope = exported.scope;
  }
  if (binding.kind === "function") return { fn: binding.fn, scope: calleeScope };
  if (binding.kind === "local" && binding.prop === null) {
    const init = unwrap(binding.init);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return { fn: init, scope: calleeScope };
    }
  }
  return null;
}

/** Argument wywołania na pozycji parametru; `"spread"` - rozkład przed nią. */
function argumentAt(call: ts.CallExpression, index: number): ts.Expression | undefined | "spread" {
  const args = call.arguments;
  if (args.slice(0, index + 1).some((a) => ts.isSpreadElement(a))) return "spread";
  return args[index];
}

function callRole(
  call: ts.CallExpression,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  if (isLooseHelperCall(call, LOOSE_CLIENT, scope, env.flow.known)) {
    return looseMeasuredRole(call.arguments[0], scope, env, depth + 1);
  }
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return unknownRole(`wywołanie ${compactText(callee, scope)}`);
  if (isSupabaseCreateClient(callee, scope)) return createClientRole(call, scope);
  const target = calledFunction(callee, scope, env);
  if (target === null) return unknownRole(`${callee.text}(): nie funkcja do odczytu`);
  const { fn, scope: calleeScope } = target;
  const returns = returnExpressions(fn);
  if (returns === null) return unknownRole(`${callee.text}(): bez ciała`);
  const roles: RoleResolution[] = [];
  for (const value of returns.flatMap(alternativesOf)) {
    if (
      value.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(value) && value.text === "undefined") ||
      ts.isVoidExpression(value)
    ) {
      continue;
    }
    // `return parametr` / `return parametr.p` - argument TEGO wywołania.
    const base = ts.isPropertyAccessExpression(value) ? unwrap(value.expression) : value;
    const ref = ts.isIdentifier(base) ? bindingOf(base, calleeScope) : null;
    if (ref !== null && ref.kind === "param" && ref.fn === fn) {
      const prop = ts.isPropertyAccessExpression(value) ? value.name.text : null;
      if (ref.prop !== null && prop !== null) {
        roles.push(unknownRole(`${callee.text}(): zagnieżdżona właściwość parametru`));
        continue;
      }
      const arg = argumentAt(call, ref.index);
      if (arg === "spread") return unknownRole(`${callee.text}(): argument z rozkładu`);
      if (arg === undefined) continue;
      const member = prop ?? ref.prop;
      roles.push(
        member === null
          ? measuredRole(arg, scope, env, depth + 1)
          : memberRole(arg, member, scope, env, depth + 1),
      );
      continue;
    }
    roles.push(measuredRole(value, calleeScope, env, depth + 1));
  }
  return agreeingRole(`${callee.text}()`, roles);
}

/** Odwołania spoza importów nazwanych (indeks budowany raz). */
function moduleRefsOf(file: string, env: RoleEnv): readonly ModuleRef[] {
  if (env.moduleRefs === null) {
    const index = new Map<string, ModuleRef[]>();
    const add = (scope: FileScope, spec: string, node: ts.Node): void => {
      const target = resolveModule(scope.file, spec, env.flow.known);
      if (target === null) return;
      const list = index.get(target) ?? [];
      list.push({ scope, node });
      index.set(target, list);
    };
    for (const scope of env.flow.scopes.values()) {
      const visit = (node: ts.Node): void => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.importClause?.namedBindings !== undefined &&
          ts.isNamespaceImport(node.importClause.namedBindings)
        ) {
          add(scope, node.moduleSpecifier.text, node);
        } else if (
          ts.isExportDeclaration(node) &&
          node.moduleSpecifier !== undefined &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          add(scope, node.moduleSpecifier.text, node);
        } else if (ts.isCallExpression(node)) {
          const spec = dynamicImportSpec(node);
          if (spec !== null) add(scope, spec, node);
        }
        ts.forEachChild(node, visit);
      };
      visit(scope.sf);
    }
    env.moduleRefs = index;
  }
  return env.moduleRefs.get(file) ?? [];
}

/** Czy identyfikator jest odwołaniem do WARTOŚCI (nie nazwą właściwości, nie typem). */
function isValueReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isJsxAttribute(p)) &&
    p.name === id
  ) {
    return false;
  }
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  if (ts.isExportSpecifier(p)) {
    return p.parent.parent.moduleSpecifier === undefined && (p.propertyName ?? p.name) === id;
  }
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  for (let n: ts.Node = p; !ts.isSourceFile(n); n = n.parent) {
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return false;
    if (ts.isStatement(n)) break;
  }
  return true;
}

/** Wywołania `name(...)`, gdy KAŻDE odwołanie do nazwy w `root` jest wywołaniem wprost; inaczej `null`. */
function directCallReferences(
  root: ts.Node,
  name: string,
  declaration: ts.Node | null,
): ts.CallExpression[] | null {
  const calls: ts.CallExpression[] = [];
  let complete = true;
  const visit = (node: ts.Node): void => {
    if (!complete) return;
    if (ts.isIdentifier(node)) {
      if (node.text === name && node !== declaration && isValueReference(node)) {
        const outer = outermostWrapper(node);
        if (ts.isCallExpression(outer.parent) && outer.parent.expression === outer) {
          calls.push(outer.parent);
        } else complete = false;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return complete ? calls : null;
}

/** Wywołania przez `import()`: rozkład `const { f } = await import(...)` albo `(await import(...)).f(...)`. */
function dynamicImportCalls(ref: ModuleRef, name: string): CallSite[] | null {
  if (!ts.isCallExpression(ref.node)) return null; // przestrzeń nazw, reeksport
  let outer: ts.Node = ref.node;
  while (
    (ts.isAwaitExpression(outer.parent) ||
      ts.isParenthesizedExpression(outer.parent) ||
      ts.isAsExpression(outer.parent) ||
      ts.isNonNullExpression(outer.parent)) &&
    outer.parent.expression === outer
  ) {
    outer = outer.parent;
  }
  const parent = outer.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
    if (parent.name.text !== name) return [];
    const wrapped = outermostWrapper(parent);
    return ts.isCallExpression(wrapped.parent) && wrapped.parent.expression === wrapped
      ? [{ call: wrapped.parent, scope: ref.scope }]
      : null;
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === outer &&
    ts.isObjectBindingPattern(parent.name) &&
    ts.isVariableDeclarationList(parent.parent) &&
    parent.parent.flags & ts.NodeFlags.Const &&
    ts.isVariableStatement(parent.parent.parent)
  ) {
    const block = parent.parent.parent.parent;
    const sites: CallSite[] = [];
    for (const el of parent.name.elements) {
      if (el.dotDotDotToken) return null;
      const source = el.propertyName
        ? propName(el.propertyName)
        : ts.isIdentifier(el.name)
          ? el.name.text
          : null;
      if (source !== name) continue;
      if (!ts.isIdentifier(el.name)) return null;
      const local = el.name.text;
      if (bindingCount(block, local) !== 1 || isAssigned(block, local)) return null;
      const calls = directCallReferences(block, local, el.name);
      if (calls === null) return null;
      sites.push(...calls.map((call) => ({ call, scope: ref.scope })));
    }
    return sites;
  }
  return null;
}

/**
 * WSZYSTKIE wywołania funkcji albo `null`, gdy nie da się ich zobaczyć
 * w całości (funkcja anonimowa, nazwa użyta jako wartość, reeksport,
 * import przestrzeni nazw, `import()` bez rozkładu, eksport domyślny).
 */
function callSitesOf(
  fn: ts.SignatureDeclaration,
  scope: FileScope,
  env: RoleEnv,
): readonly CallSite[] | null {
  if (env.sites.has(fn)) return env.sites.get(fn) ?? null;
  const compute = (): CallSite[] | null => {
    let name: string;
    let statement: ts.Statement;
    let declaration: ts.Node;
    if (ts.isFunctionDeclaration(fn)) {
      if (fn.name === undefined || fn.body === undefined) return null;
      name = fn.name.text;
      statement = fn;
      declaration = fn.name;
    } else if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
      const outer = outermostWrapper(fn);
      const decl = outer.parent;
      // Callback oddany funkcji G jako argument k: wywołania to KAŻDE użycie
      // parametru k w ciele G (wszystkie muszą być wywołaniami wprost) - dla
      // wszystkich callbacków, jakie G dostaje, więc zbiór jest nadzbiorem.
      if (ts.isCallExpression(decl) && decl.expression !== outer) {
        const k = decl.arguments.indexOf(outer);
        const callee = unwrap(decl.expression);
        if (k === -1 || decl.arguments.slice(0, k).some(ts.isSpreadElement)) return null;
        const target = ts.isIdentifier(callee) ? calledFunction(callee, scope, env) : null;
        const param = target?.fn.parameters[k];
        if (
          target == null ||
          param === undefined ||
          !ts.isIdentifier(param.name) ||
          param.dotDotDotToken !== undefined ||
          param.initializer !== undefined ||
          isAssigned(target.fn, param.name.text)
        ) {
          return null;
        }
        const invocations = directCallReferences(target.fn, param.name.text, param.name);
        return invocations === null
          ? null
          : invocations.map((call) => ({ call, scope: target.scope }));
      }
      if (
        !ts.isVariableDeclaration(decl) ||
        decl.initializer !== outer ||
        !ts.isIdentifier(decl.name) ||
        !ts.isVariableDeclarationList(decl.parent) ||
        !(decl.parent.flags & ts.NodeFlags.Const) ||
        !ts.isVariableStatement(decl.parent.parent)
      ) {
        return null;
      }
      name = decl.name.text;
      statement = decl.parent.parent;
      declaration = decl.name;
    } else {
      return null;
    }
    const container = statement.parent;
    if (bindingCount(container, name) !== 1 || isAssigned(container, name)) return null;
    const own = directCallReferences(container, name, declaration);
    if (own === null) return null;
    const sites: CallSite[] = own.map((call) => ({ call, scope }));
    if (!ts.isSourceFile(container) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      return sites;
    }
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return null;
    for (const ref of moduleRefsOf(scope.file, env)) {
      const more = dynamicImportCalls(ref, name);
      if (more === null) return null;
      sites.push(...more);
    }
    for (const imp of importersOf(scope.file, env.flow)) {
      if (imp.imported !== name) continue;
      if (bindingCount(imp.scope.sf, imp.local) !== 0) return null;
      const more = directCallReferences(imp.scope.sf, imp.local, null);
      if (more === null) return null;
      sites.push(...more.map((call) => ({ call, scope: imp.scope })));
    }
    return sites;
  };
  const sites = compute();
  env.sites.set(fn, sites);
  return sites;
}

/** Rola parametru (albo jego właściwości) ze WSZYSTKICH wywołań funkcji. */
function paramRole(
  fn: ts.SignatureDeclaration,
  index: number,
  prop: string | null,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  const label = `parametr ${index + 1}${prop === null ? "" : `.${prop}`} funkcji ${functionName(fn) ?? "<anonimowa>"}`;
  if (depth > ROLE_FLOW_MAX_DEPTH) {
    env.depthCuts += 1;
    return unknownRole(`${label}: przepływ roli dłuższy niż ${ROLE_FLOW_MAX_DEPTH} skoków`);
  }
  const key = `${scope.file}:${fn.getStart(scope.sf)}:${index}:${prop ?? ""}`;
  const cached = env.memo.get(key);
  if (cached !== undefined) return cached;
  env.memo.set(key, unknownRole(`${label}: cykl wywołań`));
  const cutsBefore = env.depthCuts;
  const sites = callSitesOf(fn, scope, env);
  let result: RoleResolution;
  if (sites === null) {
    result = unknownRole(`${label}: nie każde odwołanie do funkcji to widoczne wywołanie`);
  } else {
    const roles: RoleResolution[] = [];
    let spread = false;
    for (const site of sites) {
      const arg = argumentAt(site.call, index);
      if (arg === "spread") {
        spread = true;
        break;
      }
      if (arg === undefined) continue;
      roles.push(
        prop === null
          ? measuredRole(arg, site.scope, env, depth + 1)
          : memberRole(arg, prop, site.scope, env, depth + 1),
      );
    }
    result = spread
      ? unknownRole(`${label}: argument z rozkładu`)
      : roles.length === 0
        ? { ...unknownRole(`${label}: argument pominięty we wszystkich wywołaniach`), absent: true }
        : agreeingRole(`${label} (${sites.length} wywołań)`, roles);
  }
  if (env.depthCuts === cutsBefore) env.memo.set(key, result);
  else env.memo.delete(key);
  return result;
}

/**
 * Rola parametru z wartością domyślną: wartość domyślna (wykonuje się, gdy
 * wołający pominie argument albo poda `undefined`) i KAŻDY podany argument
 * muszą dać tę samą rolę. Domyślna liczy się zawsze - także gdy dziś żaden
 * wołający jej nie pomija: to nadzbiór wartości, nigdy zgadywanie.
 * Argument nieobecny (opcjonalny parametr wołającego, pomijany przez
 * wszystkich) nie niesie klienta - działa wtedy wartość domyślna.
 */
function defaultedParamRole(
  fn: ts.SignatureDeclaration,
  index: number,
  init: ts.Expression,
  scope: FileScope,
  env: RoleEnv,
  depth: number,
): RoleResolution {
  const label = `parametr ${index + 1} funkcji ${functionName(fn) ?? "<anonimowa>"} z wartością domyślną`;
  const fallback = measuredRole(init, scope, env, depth + 1);
  const passed = paramRole(fn, index, null, scope, env, depth);
  return agreeingRole(label, [
    { ...fallback, via: `domyślna ${fallback.via}`.slice(0, MAX_VIA) },
    passed,
  ]);
}

// ── Miara poza bramką: kolumny filtrów i sortowania ─────────────────────────
//
// Postgres wymaga SELECT na kolumnie użytej w WHERE i ORDER BY - także
// w UPDATE i DELETE - oraz na kolumnach celu `ON CONFLICT (...)`, a przy
// `DO UPDATE SET c = EXCLUDED.c` (upsert PostgREST bez `ignoreDuplicates`)
// także na każdej kolumnie ładunku (sprawdzone na PG16). Fakt filtra to:
// tabela, kolumna, rola i plik literału kolumny. Źródła kolumny:
//   * pierwszy argument metod filtra postgrest-js (`FILTER_COLUMN_METHODS`),
//     także `"osadzenie.kolumna"`, `"kolumna->>klucz"` i `order("rel(kol)")`;
//   * klucze `.match({ ... })`;
//   * napis `.or("a.eq.x,and(b.gt.1,c.is.null)")` - literał, szablon
//     z kolumną w literale (`kolumna.ilike.${v}`), `[...].join(",")`
//     i `xs.map(cb).join(",")`; `referencedTable`/`foreignTable` w opcjach
//     `.or` i `.order` przenoszą kolumny do tabeli osadzonej;
//   * cel `onConflict` (bez niego - klucz główny) i kolumny ładunku upsertu.
// Wartości z warunku (`c ? "a" : "b"`) dają oba warianty, parametr - wartości
// z wywołań (reguła przepływu kolumn). Osadzenie mapujemy na tabelę przez
// listę `select` tego samego łańcucha (`alias:tabela!fk(...)`); nieczytelne -
// `unresolvedFilters`, nigdy zgadywanie.

/** Metody filtra i sortowania z kolumną w pierwszym argumencie (postgrest-js 2.x). */
export const FILTER_COLUMN_METHODS: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "likeAllOf",
  "likeAnyOf",
  "ilike",
  "ilikeAllOf",
  "ilikeAnyOf",
  "regexMatch",
  "regexIMatch",
  "is",
  "isDistinct",
  "in",
  "notIn",
  "contains",
  "containedBy",
  "rangeGt",
  "rangeGte",
  "rangeLt",
  "rangeLte",
  "rangeAdjacent",
  "overlaps",
  "textSearch",
  "not",
  "filter",
  "order",
]);

const FILTER_METHODS: ReadonlySet<string> = new Set([...FILTER_COLUMN_METHODS, "match", "or"]);

/** Operatory PostgREST w logicznym filtrze (`or=(kol.op.wartość)`). */
const POSTGREST_OPERATORS: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "match",
  "imatch",
  "in",
  "is",
  "isdistinct",
  "fts",
  "plfts",
  "phfts",
  "wfts",
  "cs",
  "cd",
  "ov",
  "sl",
  "sr",
  "nxr",
  "nxl",
  "adj",
  "not",
]);

/** Kolumna celu konfliktu bez `onConflict` - klucz główny (rozwija SQL miary). */
export const PRIMARY_KEY_COLUMNS = "(klucz główny)";

/** Najwięcej wariantów napisu filtra (iloczyn warunków) - powyżej: nieczytelne. */
const MAX_FILTER_VARIANTS = 16;

/** Kolumna (ze ścieżką osadzenia) z argumentu filtra; `null` - nie kolumna. */
export function filterColumnPath(raw: string): { embed: string[]; column: string } | null {
  const text = raw.trim();
  const related = /^([a-z_][a-z0-9_]*)\(([a-z_][a-z0-9_]*)\)$/.exec(text);
  if (related !== null) return { embed: [related[1]], column: related[2] };
  const arrow = text.indexOf("->");
  const parts = (arrow === -1 ? text : text.slice(0, arrow)).split(".");
  if (parts.some((p) => !COLUMN_RE.test(p))) return null;
  return { embed: parts.slice(0, -1), column: parts[parts.length - 1] };
}

/** Warunki listy `or`/`and` na najwyższym poziomie (nawiasy, klamry i cudzysłowy chronią przecinek). */
function splitFilterConditions(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\\" && i + 1 < text.length) {
        current += ch + text[i + 1];
        i += 1;
        continue;
      }
      if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    // `in.(a,b)`, `and(...)` i tablice `cs.{a,b}` / `like(any).{a,b}`.
    else if (ch === "(" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * Ścieżki kolumn z logicznego filtra PostgREST (`a.eq.1,and(b.gt.2,emb.c.is.null)`).
 * `unresolved` - warunki bez rozpoznanego operatora albo z kolumną znaną
 * dopiero w czasie działania.
 */
export function parseOrFilterColumns(text: string): { paths: string[]; unresolved: string[] } {
  const paths: string[] = [];
  const unresolved: string[] = [];
  const walk = (list: string, depth: number): void => {
    for (const cond of splitFilterConditions(list)) {
      const logic = /^(?:not\.)?(?:and|or)\(([\s\S]*)\)$/.exec(cond);
      if (logic !== null && depth < 8) {
        walk(logic[1], depth + 1);
        continue;
      }
      const tokens = cond.split(".");
      const op = tokens.findIndex(
        (t, i) => i > 0 && POSTGREST_OPERATORS.has(t.replace(/\((?:any|all)\)$/, "")),
      );
      const path = op > 0 ? tokens.slice(0, op).join(".") : null;
      if (path === null || path.includes(RUNTIME_PART)) unresolved.push(cond);
      else paths.push(path);
    }
  };
  walk(text, 0);
  return { paths, unresolved };
}

/** Zasoby osadzone listy `select`: nazwa (alias albo relacja) -> relacja i jej lista. */
function selectEmbeds(select: string): Map<string, { rel: string; inner: string }> {
  const out = new Map<string, { rel: string; inner: string }>();
  for (const raw of splitTopLevel(select)) {
    const open = raw.indexOf("(");
    if (open === -1 || !raw.endsWith(")")) continue;
    const inner = raw.slice(open + 1, -1);
    if (inner.trim().length === 0) continue; // agregat `count()`
    let head = raw.slice(0, open).trim();
    if (head.startsWith("...")) head = head.slice(3);
    let alias: string | null = null;
    const colon = head.indexOf(":");
    if (colon !== -1) {
      alias = head.slice(0, colon).trim();
      head = head.slice(colon + 1).trim();
    }
    const rel = head.split("!")[0].trim();
    if (!COLUMN_RE.test(rel)) continue;
    if (alias !== null) out.set(alias, { rel, inner });
    if (!out.has(rel)) out.set(rel, { rel, inner });
  }
  return out;
}

/** Tabela ścieżki osadzenia (`a.b`) według listy `select`; `null` - nieczytelna. */
export function embeddedTable(select: string | null, path: readonly string[]): string | null {
  let current = select;
  let table: string | null = null;
  for (const segment of path) {
    if (current === null) return null;
    const embed = selectEmbeds(current).get(segment);
    if (embed === undefined) return null;
    table = embed.rel;
    current = embed.inner;
  }
  return table;
}

function variantProduct(a: FlowPart[][], b: FlowPart[][]): FlowPart[][] | null {
  if (a.length * b.length > MAX_FILTER_VARIANTS) return null;
  return a.flatMap((x) => b.map((y) => [...x, ...y]));
}

/**
 * Warianty napisu filtra (kolumny albo listy `or`): jak `flowTemplate`, ale
 * warunek i `??` dają OBA warianty, a `xs.map(cb).join(sep)` - wynik `cb`
 * z wartościami czasu działania. `null` - wiązanie poza regułą.
 */
function filterVariants(
  expr: ts.Expression,
  ctx: FlowCtx,
  env: FlowEnv,
  depth: number,
): FlowPart[][] | null {
  if (depth > 8) return null;
  const node = unwrap(expr);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [[node.text]];
  const union = (parts: ts.Expression[]): FlowPart[][] | null => {
    const out: FlowPart[][] = [];
    for (const part of parts) {
      const v = filterVariants(part, ctx, env, depth + 1);
      if (v === null) return null;
      out.push(...v);
    }
    return out.length > MAX_FILTER_VARIANTS ? null : out;
  };
  if (ts.isConditionalExpression(node)) return union([node.whenTrue, node.whenFalse]);
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken) {
      return union([node.left, node.right]);
    }
    if (kind === ts.SyntaxKind.PlusToken) {
      const left = filterVariants(node.left, ctx, env, depth + 1);
      const right = filterVariants(node.right, ctx, env, depth + 1);
      return left === null || right === null ? null : variantProduct(left, right);
    }
  }
  if (ts.isTemplateExpression(node)) {
    let acc: FlowPart[][] | null = [[node.head.text]];
    for (const span of node.templateSpans) {
      const inner = filterVariants(span.expression, ctx, env, depth + 1);
      if (inner === null || acc === null) return null;
      acc = variantProduct(
        acc,
        inner.map((v) => [...v, span.literal.text]),
      );
    }
    return acc;
  }
  if (ts.isIdentifier(node)) {
    // Wiązanie poza regułą (`let`, przesłonięcie) to wartość czasu działania:
    // na miejscu KOLUMNY czyni warunek nieczytelnym, na miejscu wartości -
    // nic nie zmienia (kolumny filtra nie zależą od wartości).
    const name = node.text;
    if (ctx.lambdas.some((cb) => bindingCount(cb, name) > 0)) return [[RUNTIME_PART]];
    if (ctx.fn !== null) {
      const index = flowParamIndex(ctx.fn, name);
      if (index === null) return [[RUNTIME_PART]];
      if (index >= 0) return [[{ param: index }]];
      const init = flowLocalConst(ctx.fn, name, node);
      if (init === null) return [[RUNTIME_PART]];
      if (init !== undefined) return filterVariants(init, ctx, env, depth + 1);
    }
    const parts = flowIdentifier(node, { ...ctx, fn: null }, env, depth);
    return parts === null ? [[RUNTIME_PART]] : [parts];
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join" &&
    node.arguments.length === 1
  ) {
    const sepVariants = filterVariants(node.arguments[0], ctx, env, depth + 1);
    const sep =
      sepVariants?.length === 1 &&
      sepVariants[0].every((p): p is string => typeof p === "string" && !p.includes(RUNTIME_PART))
        ? sepVariants[0].join("")
        : null;
    if (sep === null) return null;
    const list = unwrap(node.expression.expression);
    if (ts.isArrayLiteralExpression(list)) {
      let acc: FlowPart[][] | null = [[]];
      for (const [i, el] of list.elements.entries()) {
        const item = ts.isSpreadElement(el)
          ? mappedItemVariants(el.expression, ctx, env, depth + 1)
          : filterVariants(el, ctx, env, depth + 1);
        if (item === null || acc === null) return null;
        acc = variantProduct(
          acc,
          item.map((v) => (i > 0 ? [sep, ...v] : v)),
        );
      }
      return acc;
    }
    return mappedItemVariants(list, ctx, env, depth + 1);
  }
  return [[RUNTIME_PART]];
}

/** Element `xs.map(cb)` - jeden reprezentatywny wynik `cb`; inaczej wartość czasu działania. */
function mappedItemVariants(
  expr: ts.Expression,
  ctx: FlowCtx,
  env: FlowEnv,
  depth: number,
): FlowPart[][] | null {
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
        return filterVariants(result, { ...ctx, lambdas: [...ctx.lambdas, cb] }, env, depth + 1);
      }
    }
  }
  return [[RUNTIME_PART]];
}

/**
 * Napisy filtra (z plikiem literału) dla wyrażenia; `why` - dlaczego część
 * nieczytelna. Parametr najbliższej funkcji bierze wartości z wywołań (reguła
 * przepływu kolumn), a gdy wywołań nie widać albo parametrów jest kilka -
 * zostaje wartością czasu działania: kolumna z niego jest wtedy nieczytelna,
 * a kolumny z literału (`email.ilike.${term}`) - nie.
 */
function filterTexts(
  expr: ts.Expression,
  call: ts.CallExpression,
  scope: FileScope,
  env: FlowEnv,
): { values: FlowValue[]; why: string | null } {
  const fn = enclosingFunction(call);
  const variants = filterVariants(expr, { scope, fn, lambdas: [] }, env, 0);
  if (variants === null) return { values: [], why: "zbyt wiele wariantów napisu" };
  const values: FlowValue[] = [];
  for (const variant of variants) {
    const params = flowParams(variant);
    const flowed =
      params.length === 1 && fn !== null
        ? flowParamValues(fn, params[0], scope, env, 1, new Set())
        : [];
    if (flowed.length === 0) {
      values.push({ text: flowSubstitute(variant, RUNTIME_PART), file: scope.file });
    }
    for (const v of flowed) {
      values.push({ text: flowSubstitute(variant, v.text), file: v.file });
    }
  }
  return { values, why: null };
}

/** Opcja `referencedTable`/`foreignTable` (literał) - ścieżka osadzenia; `undefined` - brak opcji. */
function referencedTableOption(
  opts: ts.Expression | undefined,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
): string[] | null | undefined {
  if (opts === undefined) return undefined;
  const node = unwrap(opts);
  if (!ts.isObjectLiteralExpression(node)) return null;
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) return null;
    if (!ts.isPropertyAssignment(p)) continue;
    const key = propName(p.name);
    if (key !== "referencedTable" && key !== "foreignTable") continue;
    const value = resolveString(p.initializer, scope, exportsIndex, known);
    if (value === null) return null;
    const path = value.split(".");
    return path.every((s) => COLUMN_RE.test(s)) ? path : null;
  }
  return undefined;
}

interface FilterColumn {
  readonly embed: readonly string[];
  readonly column: string;
  readonly file: string;
}

/** Kolumny jednego wywołania filtra; `unresolved` - opisy części nieczytelnych. */
function filterCallColumns(
  call: ts.CallExpression,
  method: string,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  env: FlowEnv,
): { columns: FilterColumn[]; unresolved: string[] } {
  const columns: FilterColumn[] = [];
  const unresolved: string[] = [];
  const arg = call.arguments[0];
  if (arg === undefined || ts.isSpreadElement(arg)) {
    return { columns, unresolved: ["argument nieczytelny"] };
  }
  if (method === "match") {
    const objects = objectArgument(arg, scope);
    if (objects === null || objects.some((o) => o.properties.some(ts.isSpreadAssignment))) {
      return { columns, unresolved: ["obiekt `match` nieczytelny"] };
    }
    for (const key of objectShape(objects, scope, exportsIndex, known).keys) {
      const path = filterColumnPath(key);
      if (path === null) unresolved.push(`klucz ${key}`);
      else columns.push({ ...path, file: scope.file });
    }
    return { columns, unresolved };
  }
  const prefix =
    method === "or" || method === "order"
      ? referencedTableOption(call.arguments[1], scope, exportsIndex, known)
      : undefined;
  if (prefix === null) return { columns, unresolved: ["opcja referencedTable nieczytelna"] };
  const { values, why } = filterTexts(arg, call, scope, env);
  if (why !== null) unresolved.push(why);
  for (const value of values) {
    const paths =
      method === "or" ? parseOrFilterColumns(value.text) : { paths: [value.text], unresolved: [] };
    for (const cond of paths.unresolved)
      unresolved.push(`warunek ${cond.replaceAll(RUNTIME_PART, "${…}")}`);
    for (const raw of paths.paths) {
      const path = raw.includes(RUNTIME_PART) ? null : filterColumnPath(raw);
      if (path === null) {
        unresolved.push(`kolumna ${raw.replaceAll(RUNTIME_PART, "${…}")}`);
        continue;
      }
      columns.push({
        embed: [...(prefix ?? []), ...path.embed],
        column: path.column,
        file: value.file,
      });
    }
  }
  return { columns, unresolved };
}

/** Czy wywołanie MA kształt filtra PostgREST (dla wywołań spoza rozpoznanego łańcucha). */
function looksLikePostgrestFilter(call: ts.CallExpression, method: string): boolean {
  const n = call.arguments.length;
  const first = n > 0 ? unwrap(call.arguments[0]) : null;
  const text =
    first !== null &&
    (ts.isStringLiteral(first) ||
      ts.isNoSubstitutionTemplateLiteral(first) ||
      ts.isTemplateExpression(first));
  switch (method) {
    case "or":
      return n >= 1 && n <= 2;
    case "match":
      return n === 1 && first !== null && ts.isObjectLiteralExpression(first);
    case "not":
    case "filter":
      return n === 3;
    case "order":
      return text && n >= 1 && n <= 2;
    case "contains":
    case "containedBy":
    case "overlaps":
      return text && n === 2;
    default:
      return n >= 2 && n <= 3;
  }
}

/** Metody budowniczego PostgREST, przez które przechodzi łańcuch w dół do `.from()`. */
const BUILDER_CHAIN_METHODS: ReadonlySet<string> = new Set([
  ...FILTER_METHODS,
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
  "limit",
  "range",
  "single",
  "maybeSingle",
  "returns",
  "overrideTypes",
  "abortSignal",
  "throwOnError",
  "setHeader",
  "maxAffected",
  "csv",
  "explain",
]);

/** Budowniczy rozpoznany przez wartość (parametr, fabryka, stała): tabela, rola, `select`, operacja. */
interface BuilderRef {
  readonly table: string;
  readonly role: RoleResolution;
  readonly select: string | null;
  readonly op: TableOp;
}

/**
 * Budowniczy pod wyrażeniem: łańcuch w dół do `.from(t)`/`looseTable(x, t)`,
 * przez stałą, `let` przypisywany (`out = applyX(out)`: inicjalizator, a
 * odwołania do samej zmiennej w prawych stronach - ten sam zbiór), warunek
 * (obie gałęzie), funkcję zwracającą budowniczego (każdy `return`)
 * i parametr (WSZYSTKIE wywołania, także callback wołany w funkcji, której
 * go oddano). `null` - którakolwiek wartość nieczytelna.
 */
function builderOf(
  expr: ts.Expression,
  scope: FileScope,
  env: MeasureEnv,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  depth: number,
  above: { readonly select: string | null; readonly op: TableOp },
  assumed: ReadonlyMap<ts.Node, BuilderRef[]> = new Map(),
): BuilderRef[] | null {
  if (depth > ROLE_FLOW_MAX_DEPTH) return null;
  let node = unwrap(expr);
  let select = above.select;
  let op = above.op;
  const tableOf = (arg: ts.Expression | undefined): string | null => {
    const table = arg === undefined ? null : resolveString(arg, scope, exportsIndex, known);
    return table !== null && COLUMN_RE.test(table) ? table : null;
  };
  const all = (parts: (BuilderRef[] | null)[]): BuilderRef[] | null => {
    if (parts.length === 0 || parts.some((p) => p === null)) return null;
    const out = (parts as BuilderRef[][]).flat();
    return out.length === 0 ? null : out;
  };
  const next = (e: ts.Expression, at: FileScope, more = assumed): BuilderRef[] | null =>
    builderOf(e, at, env, exportsIndex, known, depth + 1, { select, op }, more);
  for (;;) {
    if (ts.isCallExpression(node)) {
      if (isLooseTableCall(node, scope, known)) {
        const table = tableOf(node.arguments[1]);
        if (table === null) return null;
        const role = looseMeasuredRole(node.arguments[0], scope, env.roles, 0);
        return [{ table, role, select, op }];
      }
      if (isTableFrom(node)) {
        const method = callMethod(node);
        const recv = method === null ? null : unwrap(method.receiver);
        if (
          recv === null ||
          (ts.isPropertyAccessExpression(recv) && recv.name.text === "storage")
        ) {
          return null;
        }
        const table = tableOf(node.arguments[0]);
        if (table === null) return null;
        return [{ table, role: measuredRole(recv, scope, env.roles, 0), select, op }];
      }
      const method = callMethod(node);
      if (method !== null) {
        if (!BUILDER_CHAIN_METHODS.has(method.name)) return null;
        if (method.name === "select" && select === null) {
          select =
            node.arguments[0] === undefined
              ? "*"
              : resolveString(node.arguments[0], scope, exportsIndex, known);
        }
        if (
          method.name === "update" ||
          method.name === "delete" ||
          method.name === "insert" ||
          method.name === "upsert"
        ) {
          op = method.name;
        }
        node = unwrap(method.receiver);
        continue;
      }
      // Funkcja zwracająca budowniczego: każdy `return` (wartości w jej pliku).
      const callee = unwrap(node.expression);
      const target = ts.isIdentifier(callee) ? calledFunction(callee, scope, env.roles) : null;
      const returns = target === null ? null : returnExpressions(target.fn);
      if (target === null || returns === null) return null;
      return all(returns.flatMap(alternativesOf).map((r) => next(r, target.scope)));
    }
    if (ts.isConditionalExpression(node)) {
      return all([node.whenTrue, node.whenFalse].map((b) => next(b, scope)));
    }
    if (!ts.isIdentifier(node)) return null;
    const binding = bindingOf(node, scope);
    if (binding.kind === "local" && binding.prop === null) return next(binding.init, scope);
    if (binding.kind === "reassigned") {
      const known_ = assumed.get(binding.decl);
      if (known_ !== undefined) return known_;
      const [first, ...rest] = binding.values;
      const base = next(first, scope);
      if (base === null) return null;
      const more = new Map(assumed).set(binding.decl, base);
      return all([base, ...rest.map((v) => next(v, scope, more))]);
    }
    if (binding.kind === "param" && binding.prop === null) {
      const sites = callSitesOf(binding.fn, scope, env.roles);
      if (sites === null) return null;
      const parts: (BuilderRef[] | null)[] = [];
      for (const site of sites) {
        const arg = argumentAt(site.call, binding.index);
        if (arg === "spread") return null;
        if (arg === undefined) continue;
        parts.push(next(arg, site.scope));
      }
      return all(parts);
    }
    return null;
  }
}

/** Korzeń łańcucha filtra: odbiorca pierwszego ogniwa spoza metod budowniczego. */
function filterChainRoot(expr: ts.Expression): ts.Expression {
  let node: ts.Expression = expr;
  for (;;) {
    const inner = unwrap(node);
    const method = ts.isCallExpression(inner) ? callMethod(inner) : null;
    if (method === null || !BUILDER_CHAIN_METHODS.has(method.name)) return inner;
    node = method.receiver;
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
  /** Miara poza bramką (`SeamFacts.observed`). */
  observed: {
    rpcs: ObservedRpc[];
    tables: ObservedTable[];
    filters: FilterSite[];
    statements: ObservedStatement[];
    /** Klucze `statements` - to samo zapytanie z kilku przebiegów tylko raz. */
    statementKeys: Set<string>;
    unresolvedFilters: string[];
    filtersOutsideChains: string[];
    /** Wywołania filtra obejrzane na rozpoznanym budowniczym (fakt albo miejsce nieczytelne). */
    visitedFilters: Set<ts.CallExpression>;
  };
}

/** Środowisko miary: rola szerzej i osobny przebieg przepływu kolumn filtrów. */
interface MeasureEnv {
  readonly roles: RoleEnv;
  /**
   * Własny `FlowEnv` filtrów: miejsca nieczytelne i licznik zgłoszeń reguły
   * przepływu kolumn `select` (zapadki bramki) zostają nietknięte.
   */
  readonly filters: FlowEnv;
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
  measure: MeasureEnv | null,
): void {
  const selects: ts.CallExpression[] = [];
  const filters: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = callMethod(node);
      if (method?.name === "rpc" && node.arguments.length >= 1) {
        handleRpc(node, method.receiver, scope, exportsIndex, known, out, measure);
      } else if (method?.name === "from" && node.arguments.length === 1) {
        handleFrom(node, method.receiver, scope, exportsIndex, known, out, flow, measure);
      } else if (isLooseTableCall(node, scope, known)) {
        const role = looseSourceRole(node.arguments[0], scope, known);
        const measured =
          measure === null
            ? null
            : { env: measure, role: looseMeasuredRole(node.arguments[0], scope, measure.roles, 0) };
        handleBuilder(
          node,
          node.arguments[1],
          role,
          false,
          scope,
          exportsIndex,
          known,
          out,
          flow,
          measured,
        );
      } else if (method?.name === "select") {
        selects.push(node);
      } else if (measure !== null && method !== null && FILTER_METHODS.has(method.name)) {
        filters.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope.sf);
  // Miara: filtr na budowniczym, którego łańcuch nie został obejrzany
  // (zmienna z budowniczym w innej funkcji, warunek), to miejsce
  // nieczytelne; filtr na odbiorcy bez związku z budowniczym (parametr
  // pomocnika) - szacunek luki po samym kształcie wywołania.
  for (const call of measure === null ? [] : filters) {
    if (measure === null || out.observed.visitedFilters.has(call)) continue;
    const method = (call.expression as ts.PropertyAccessExpression).name.text;
    if (!looksLikePostgrestFilter(call, method)) continue;
    const receiver = (call.expression as ts.PropertyAccessExpression).expression;
    const root = filterChainRoot(receiver);
    // `Object.is(a, b)`, `Array.from(...)` - konstruktory globalne, nie klient.
    if (ts.isIdentifier(root) && /^[A-Z]/.test(root.text)) continue;
    // Filtr i sortowanie wyniku `.rpc(...)` to kolumny wyniku funkcji, nie
    // tabeli - uprawnień kolumn nie wymagają.
    if (ts.isCallExpression(root) && callMethod(root)?.name === "rpc") continue;
    const where = `${scope.file}: ${enclosingFunctionPath(call)}: .${method}(${call.arguments[0] === undefined ? "" : compactText(call.arguments[0], scope)})`;
    // Budowniczy przez wartość: parametr pomocnika (`applyFilters(q)`),
    // funkcja zwracająca budowniczego, `let` przedłużany samym sobą.
    const builders = builderOf(receiver, scope, measure, exportsIndex, known, 0, {
      select: null,
      op: "select",
    });
    if (builders !== null) {
      out.observed.visitedFilters.add(call);
      const found = filterCallColumns(call, method, scope, exportsIndex, known, measure.filters);
      for (const why of found.unresolved) out.observed.unresolvedFilters.push(`${where}: ${why}`);
      const seen = new Set<string>();
      for (const builder of builders) {
        const key = `${builder.table}|${builder.role.role}|${builder.op}|${builder.select ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const column of found.columns) {
          let rel = builder.table;
          if (column.embed.length > 0) {
            const embedded = embeddedTable(builder.select, column.embed);
            if (embedded === null) {
              out.observed.unresolvedFilters.push(
                `${where}: osadzenie ${column.embed.join(".")} bez tabeli w liście \`select\` (${builder.table})`,
              );
              continue;
            }
            rel = embedded;
          }
          out.observed.filters.push({
            table: rel,
            column: column.column,
            embed: column.embed.length > 0 ? column.embed.join(".") : null,
            method,
            op: builder.op,
            role: builder.role.role,
            via: `budowniczy przez wartość <- ${builder.role.via}`.slice(0, MAX_VIA),
            enforcedRole: "unknown",
            file: column.file,
            site: scope.file,
            fn: enclosingFunctionPath(call),
          });
        }
      }
      continue;
    }
    const table = builderTable(receiver, scope, exportsIndex, known, new Set());
    if (table !== undefined) {
      out.observed.unresolvedFilters.push(
        `${where}: budowniczy ${table ?? "?"} poza obejrzanym łańcuchem`,
      );
    } else {
      out.observed.filtersOutsideChains.push(where);
    }
  }
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
  measure: MeasureEnv | null,
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
  const role = receiverRole(receiver, scope, known);
  out.rpcs.push({ name, keys, role, file: scope.file });
  if (measure === null) return;
  const measured = measuredRole(receiver, scope, measure.roles, 0);
  out.observed.rpcs.push({
    name,
    keys,
    role: measured.role,
    via: measured.via,
    enforcedRole: role,
    file: scope.file,
    site: scope.file,
    fn: enclosingFunctionPath(node),
  });
}

function handleFrom(
  node: ts.CallExpression,
  receiver: ts.Expression,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
  flow: FlowEnv,
  measure: MeasureEnv | null,
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
  const measured =
    measure === null
      ? null
      : { env: measure, role: measuredRole(receiver, scope, measure.roles, 0) };
  handleBuilder(
    node,
    node.arguments[0],
    role,
    true,
    scope,
    exportsIndex,
    known,
    out,
    flow,
    measured,
  );
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
  measure: { readonly env: MeasureEnv; readonly role: RoleResolution } | null,
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
    // Miara: filtry budowniczego z tabelą nieczytelną - bez faktu, na liście.
    for (const chain of measure === null ? [] : chains) {
      for (const call of chain) {
        const name = callMethod(call)?.name ?? "";
        if (!FILTER_METHODS.has(name) && name !== "upsert") continue;
        out.observed.visitedFilters.add(call);
        out.observed.unresolvedFilters.push(
          `${scope.file}: ${enclosingFunctionPath(call)}: .from(${compactText(tableArg, scope)}).${name}(…): tabela nieczytelna`,
        );
      }
    }
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
  // Fakt bramki i jego lustro w mierze (ta sama tabela, operacja i kolumny,
  // rola zmierzona; `enforcedRole` - rola, z którą fakt idzie do pgTAP).
  // Łańcuch (indeks w `chains`) każdego faktu miary - do zapytań sond.
  const chainFacts: { readonly fact: ObservedTable; readonly chain: number }[] = [];
  let chainIndex = 0;
  const fact = (f: TableSite, call: ts.CallExpression): void => {
    const withheld = pushTableFact(out, f, call, scope);
    if (measure === null) return;
    const observedFact: ObservedTable = {
      ...f,
      role: measure.role.role,
      via: measure.role.via,
      enforcedRole: withheld ? "unknown" : f.role,
      site: scope.file,
      fn: enclosingFunctionPath(call),
    };
    out.observed.tables.push(observedFact);
    chainFacts.push({ fact: observedFact, chain: chainIndex });
  };
  const site = (
    call: ts.CallExpression,
    op: TableOp,
    columns: readonly string[],
    star: boolean,
  ): void => {
    fact({ table, op, columns, star, role, file: scope.file }, call);
  };

  for (const [index, chain] of chains.entries()) {
    chainIndex = index;
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
            fact(
              {
                table,
                op: "select",
                columns: parsed.columns,
                star: parsed.star,
                role,
                file: value.file,
              },
              call,
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
  if (measure !== null) {
    const chainFilters = observeChainFilters(
      chains,
      direct,
      table,
      scope,
      exportsIndex,
      known,
      out,
      measure,
    );
    observeStatements(
      chains.length,
      direct.length > 0,
      table,
      measure.role,
      scope.file,
      chainFacts,
      chainFilters,
      out,
    );
  }
}

/**
 * Zapytania łańcuchów jednego budowniczego do sond wykonania. Zapytanie to
 * łańcuch wprost (indeks 0, gdy niepusty) razem z JEDNYM łańcuchem użycia
 * zmiennej z budowniczym; bez takich użyć - sam łańcuch wprost. Odczyt:
 * kolumny `select` i filtry; zapis: ładunek, filtry (UPDATE/DELETE), lista
 * RETURNING (`select` po zapisie) i cel `ON CONFLICT` (upsert).
 */
function observeStatements(
  chainCount: number,
  hasDirect: boolean,
  table: string,
  role: RoleResolution,
  site: string,
  facts: readonly { readonly fact: ObservedTable; readonly chain: number }[],
  filters: readonly { readonly filter: FilterSite; readonly chain: number }[],
  out: Collector,
): void {
  const first = hasDirect ? 1 : 0;
  const bound = Array.from({ length: Math.max(0, chainCount - first) }, (_, i) => first + i);
  const groups = bound.length === 0 ? [[0]] : bound.map((i) => (hasDirect ? [0, i] : [i]));
  const unique = (xs: readonly string[]): string[] => [...new Set(xs)];
  for (const group of groups) {
    const inGroup = new Set(group);
    const gFacts = facts.filter((f) => inGroup.has(f.chain)).map((f) => f.fact);
    const gFilters = filters.filter((f) => inGroup.has(f.chain)).map((f) => f.filter);
    const fn = gFacts[0]?.fn ?? gFilters[0]?.fn;
    if (fn === undefined) continue;
    // Filtry tabeli łańcucha (osadzenia - osobne sondy kolumn filtra). Przy
    // upsercie to cel `ON CONFLICT` i kolumny `EXCLUDED` - WHERE ich nie bierze.
    const where = unique(gFilters.filter((f) => f.embed === null).map((f) => f.column));
    const target = unique(gFilters.filter((f) => f.method === "onConflict").map((f) => f.column));
    const selects = gFacts.filter((f) => f.op === "select");
    const columns = unique(selects.flatMap((f) => f.columns));
    const star = selects.some((f) => f.star);
    const writes = gFacts.filter((f) => f.op !== "select");
    const statements: ObservedStatement[] =
      writes.length === 0
        ? selects.length === 0 && where.length === 0
          ? []
          : [
              {
                table,
                op: "select",
                role: role.role,
                via: role.via,
                site,
                fn,
                columns,
                star,
                payload: [],
                where,
                conflict: null,
              },
            ]
        : writes.map((w) => {
            const upsert = w.op === "upsert" || w.op === "upsert_ignore";
            return {
              table,
              op: w.op,
              role: role.role,
              via: role.via,
              site,
              fn: w.fn,
              columns,
              star,
              payload: w.columns,
              where: w.op === "update" || w.op === "delete" ? where : [],
              // Cel nieczytelny (`[]`) - sonda bez celu (`ON CONFLICT DO NOTHING`), nie zgadujemy klucza.
              conflict: upsert ? target : null,
            };
          });
    for (const statement of statements) {
      const key = JSON.stringify(statement);
      if (out.observed.statementKeys.has(key)) continue;
      out.observed.statementKeys.add(key);
      out.observed.statements.push(statement);
    }
  }
}

/**
 * Miara: kolumny filtrów, sortowania i upsertu na łańcuchach budowniczego
 * tabeli `table` - rola potrzebuje na nich SELECT (także w UPDATE/DELETE).
 */
function observeChainFilters(
  chains: readonly (readonly ts.CallExpression[])[],
  direct: readonly ts.CallExpression[],
  table: string,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
  measure: { readonly env: MeasureEnv; readonly role: RoleResolution },
): { readonly filter: FilterSite; readonly chain: number }[] {
  const QUERY_OPS = new Set<string>(["update", "delete", "insert", "upsert"]);
  const pushed: { readonly filter: FilterSite; readonly chain: number }[] = [];
  for (const [chainIndex, chain] of chains.entries()) {
    const whole = chain === direct ? chain : [...direct, ...chain];
    const op =
      (whole.map((c) => callMethod(c)?.name ?? "").find((m) => QUERY_OPS.has(m)) as
        TableOp | undefined) ?? "select";
    // Lista `select` łańcucha - do mapy osadzeń (`alias:tabela!fk(...)`):
    // literał albo stała, a gdy składa ją parametr - warianty szablonu
    // (osadzenia ze stałych modułu, kolumny parametru jako wartość czasu
    // działania); tabela osadzenia musi być ta sama we wszystkich.
    const selectCall = whole.find((c) => callMethod(c)?.name === "select");
    const selectArg = selectCall?.arguments[0];
    const selectLiteral =
      selectArg === undefined ? "*" : resolveString(selectArg, scope, exportsIndex, known);
    const selectTexts: string[] | null =
      selectCall === undefined
        ? null
        : selectLiteral !== null
          ? [selectLiteral]
          : (filterVariants(
              selectArg as ts.Expression,
              { scope, fn: enclosingFunction(selectCall), lambdas: [] },
              measure.env.filters,
              0,
            )?.map((v) => flowSubstitute(v, RUNTIME_PART)) ?? null);
    for (const call of chain) {
      const method = callMethod(call)?.name ?? "";
      const where = `${scope.file}: ${enclosingFunctionPath(call)}: .from(${table}).${method}`;
      const push = (column: FilterColumn, label: string): void => {
        let rel = table;
        if (column.embed.length > 0) {
          const tables = (selectTexts ?? [null]).map((t) => embeddedTable(t, column.embed));
          const embedded = tables.every((t) => t !== null && t === tables[0]) ? tables[0] : null;
          if (embedded === null) {
            out.observed.unresolvedFilters.push(
              `${where}(${column.embed.join(".")}.${column.column}): osadzenie bez tabeli w liście \`select\``,
            );
            return;
          }
          rel = embedded;
        }
        const filter: FilterSite = {
          table: rel,
          column: column.column,
          embed: column.embed.length > 0 ? column.embed.join(".") : null,
          method: label,
          op,
          role: measure.role.role,
          via: measure.role.via,
          enforcedRole: "unknown",
          file: column.file,
          site: scope.file,
          fn: enclosingFunctionPath(call),
        };
        out.observed.filters.push(filter);
        pushed.push({ filter, chain: chainIndex });
      };
      if (method === "upsert") {
        // `ON CONFLICT (cel)` - SELECT na celu; `DO UPDATE SET c = EXCLUDED.c`
        // (bez `ignoreDuplicates`) - SELECT na każdej kolumnie ładunku.
        const opts = call.arguments[1] ? unwrap(call.arguments[1]) : null;
        let conflict: string | null | undefined;
        let ignore = false;
        if (opts !== null) {
          if (!ts.isObjectLiteralExpression(opts)) conflict = null;
          else {
            for (const p of opts.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const key = propName(p.name);
              if (key === "ignoreDuplicates") {
                ignore = p.initializer.kind === ts.SyntaxKind.TrueKeyword;
              }
              if (key === "onConflict") {
                conflict = resolveString(p.initializer, scope, exportsIndex, known);
              }
            }
          }
        }
        out.observed.visitedFilters.add(call);
        if (conflict === null) {
          out.observed.unresolvedFilters.push(`${where}: cel onConflict nieczytelny`);
        } else {
          const columns =
            conflict === undefined
              ? [PRIMARY_KEY_COLUMNS]
              : conflict
                  .split(",")
                  .map((c) => c.trim())
                  .filter((c) => c.length > 0);
          for (const column of columns) {
            if (column !== PRIMARY_KEY_COLUMNS && !COLUMN_RE.test(column)) {
              out.observed.unresolvedFilters.push(`${where}: cel onConflict ${column}`);
              continue;
            }
            push({ embed: [], column, file: scope.file }, "onConflict");
          }
        }
        if (!ignore) {
          const objects = objectArgument(call.arguments[0], scope);
          if (objects === null || objects.some((o) => o.properties.some(ts.isSpreadAssignment))) {
            out.observed.unresolvedFilters.push(`${where}: kolumny ładunku nieczytelne (EXCLUDED)`);
          } else {
            for (const column of objectShape(objects, scope, exportsIndex, known).keys) {
              push({ embed: [], column, file: scope.file }, "upsert(EXCLUDED)");
            }
          }
        }
        continue;
      }
      if (!FILTER_METHODS.has(method)) continue;
      out.observed.visitedFilters.add(call);
      const found = filterCallColumns(
        call,
        method,
        scope,
        exportsIndex,
        known,
        measure.env.filters,
      );
      for (const why of found.unresolved) {
        out.observed.unresolvedFilters.push(
          `${where}(${call.arguments[0] === undefined ? "" : compactText(call.arguments[0], scope)}): ${why}`,
        );
      }
      for (const column of found.columns) push(column, method);
    }
  }
  return pushed;
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
): boolean {
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
        return true;
      }
    }
  }
  out.tables.push(fact);
  return false;
}

/** Pełna ekstrakcja faktów szwu z kodu produkcyjnego. */
export function extractSeamFacts(
  sources: readonly SourceFile[],
  contracts: readonly PublicColumnContract[] = PUBLIC_COLUMN_CONTRACTS,
  withheldReviewed: readonly WithheldFactReviewed[] = SEAM_FACTS_WITHHELD_REVIEWED,
  options: {
    /**
     * Miara poza bramką (`observed`): kolumny filtrów i rola szerzej. Bez niej
     * (bramka CI) `observed` jest puste, a ekstrakcja - ta sama co przed miarą.
     */
    readonly observe?: boolean;
  } = {},
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
    observed: {
      rpcs: [],
      tables: [],
      filters: [],
      statements: [],
      statementKeys: new Set(),
      unresolvedFilters: [],
      filtersOutsideChains: [],
      visitedFilters: new Set(),
    },
  };
  const flow: FlowEnv = { scopes, known, unresolved: new Set(), flagged: 0, importers: null };
  const measureFlow: FlowEnv = {
    scopes,
    known,
    unresolved: new Set(),
    flagged: 0,
    importers: null,
  };
  const measure: MeasureEnv | null =
    options.observe === true
      ? {
          roles: {
            flow: measureFlow,
            moduleRefs: null,
            memo: new Map(),
            sites: new Map(),
            depthCuts: 0,
          },
          filters: measureFlow,
        }
      : null;
  for (const scope of scopes.values()) {
    visitFile(scope, exportsIndex, known, out, flow, measure);
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
    observed: {
      rpcs: out.observed.rpcs,
      tables: out.observed.tables,
      filters: out.observed.filters,
      statements: out.observed.statements,
      // Miejsca nieczytelne reguły przepływu kolumn wywołane z filtrów
      // (własny `FlowEnv` miary) dochodzą tutaj, nie do zapadki bramki.
      unresolvedFilters: [
        ...new Set([...out.observed.unresolvedFilters, ...measureFlow.unresolved]),
      ].sort(),
      filtersOutsideChains: [...out.observed.filtersOutsideChains].sort(),
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
const LANG_SUFFIX =
  "kolumny zależne od języka czasu działania (`title_${t}`, `titleCol` z warunku) - dwa warianty, generator nie rozgałęzia";
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
  "src/lib/mcp/tools/get-post.ts: handler: .from(posts).select(`id, slug, title_${t}, excerpt_${t}, cover_image_url, published_at, post_format`)":
    [1, LANG_SUFFIX],
  "src/lib/mcp/tools/list-recent-posts.ts: handler: .from(posts).select(`slug, title_${t}, excerpt_${t}, cover_image_url, published_at`)":
    [1, LANG_SUFFIX],
  "src/lib/mcp/tools/search-posts.ts: handler: .from(posts).select(`id, slug, ${titleCol}, ${excerptCol}, cover_image_url, published_at`)":
    [1, LANG_SUFFIX],
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
 * Funkcja wyboru przeciążenia RPC - wspólna dla testu pgTAP i zapytań miary,
 * żeby miara nie liczyła przeciążeń inaczej niż bramka.
 */
const RPC_MATCH_SQL = `-- Przeciazenie, ktore PostgREST wybierze dla tych kluczy: kazdy klucz to
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
`;

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
${RPC_MATCH_SQL}
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

// ── Render miary poza bramką ────────────────────────────────────────────────

/**
 * Zapytania miary (`generate:ts-sql-contract --measure`): zwykły SQL, nie
 * pgTAP - NIE trafia do `supabase/tests` ani do CI. Na bazie po wszystkich
 * migracjach zwraca listę naruszeń (rodzaj, plik, funkcja, relacja, kolumna,
 * rola zmierzona i rola bramki, problem, droga ustalenia roli) dla:
 *   * RPC i faktów tabel z rolą zmierzoną (także `anon`),
 *   * kolumn filtrów, sortowania i upsertu (SELECT; cel konfliktu bez
 *     `onConflict` - kolumny klucza głównego), także ich istnienie.
 * Rola `unknown` - tylko istnienie, bez uprawnień.
 *
 * SONDY WYKONANIA (`caught_by = execution-probe`): `has_*_privilege` patrzy
 * na samą relację albo funkcję, a odmowa bywa W ŚRODKU - widok
 * `security_invoker` złączony z tabelą bez grantu, podzapytanie polityki RLS,
 * funkcja SQL `SECURITY INVOKER` czytająca kolumnę bez grantu. Dlatego każde
 * zapytanie łańcucha (`observed.statements`) i każda kolumna filtra idą
 * w podtransakcji JAKO rola zmierzona z wiarygodnymi roszczeniami JWT
 * (administrator z seeda, nagłówek hosta najemcy): odczyt
 * `SELECT kolumny FROM rel WHERE filtr IS NULL LIMIT 0`, zapis jako `EXPLAIN`
 * tej samej instrukcji (ładunek `DEFAULT`, WHERE, RETURNING, `ON CONFLICT`)
 * - planowanie sprawdza uprawnienia każdej relacji po rozwinięciu widoków
 * i polityk, a nic nie jest zapisywane. RPC funkcji `SECURITY INVOKER`
 * wołane przez `anon`/`authenticated` (z EXECUTE) - wywołanie z NULL-ami
 * w podtransakcji. Każda sonda kończy się wycofaniem podtransakcji (wyjątek
 * wartownika), a całość - `ROLLBACK`. Naruszenie to wyłącznie 42501
 * „permission denied for …"; 42501 z własnym komunikatem (autoryzacja
 * funkcji) i inne błędy (walidacja wejścia) liczy podsumowanie sond.
 */
export function renderObservedQueries(facts: SeamFacts): string {
  const o = facts.observed;
  const rpcRows = o.rpcs.map((r) =>
    [
      sqlString(r.name),
      sqlTextArray(r.keys),
      sqlString(r.role),
      sqlString(r.enforcedRole),
      sqlString(r.via),
      sqlString(r.site),
      sqlString(r.fn),
    ].join(", "),
  );
  const tableRows = o.tables.map((t) =>
    [
      sqlString(t.table),
      sqlString(t.op),
      sqlString(t.role),
      sqlString(t.enforcedRole),
      sqlTextArray(t.columns),
      t.star ? "true" : "false",
      sqlString(t.via),
      sqlString(t.file),
      sqlString(t.site),
      sqlString(t.fn),
    ].join(", "),
  );
  const filterRows = o.filters.map((f) =>
    [
      sqlString(f.table),
      f.column === PRIMARY_KEY_COLUMNS ? "NULL" : sqlString(f.column),
      f.embed === null ? "NULL" : sqlString(f.embed),
      sqlString(f.method),
      sqlString(f.op),
      sqlString(f.role),
      sqlString(f.via),
      sqlString(f.file),
      sqlString(f.site),
      sqlString(f.fn),
    ].join(", "),
  );
  const statementRows = o.statements.map((t) =>
    [
      sqlString(t.table),
      sqlString(t.op),
      sqlString(t.role),
      sqlTextArray(t.columns),
      t.star ? "true" : "false",
      sqlTextArray(t.payload),
      sqlTextArray(t.where),
      sqlTextArray(t.conflict),
      sqlString(t.via),
      sqlString(t.site),
      sqlString(t.fn),
    ].join(", "),
  );
  const rel = (name: string): string => `to_regclass('public.' || quote_ident(${name}))`;
  const roles = "('anon', 'authenticated', 'service_role')";
  return `-- ============================================================================
-- WYGENEROWANE - MIARA POZA BRAMKA CI (\`bun run generate:ts-sql-contract --measure\`).
-- Nie jest testem pgTAP i nie trafia do supabase/tests. Zwraca naruszenia:
-- rodzaj | plik wywolania | funkcja | relacja | kolumna | rola zmierzona |
-- rola bramki | problem | droga ustalenia roli.
-- RPC: ${o.rpcs.length}, fakty tabel: ${o.tables.length}, kolumny filtrow: ${o.filters.length},
-- zapytania do sond wykonania: ${o.statements.length}.
-- Najpierw podsumowanie sond (rodzaj | wynik | liczba), potem naruszenia
-- (kolumna caught_by: privilege-check albo execution-probe).
-- WYLACZNIE baza jednorazowa: sondy RPC wykonuja ciala funkcji (wycofane, ale
-- np. sekwencje i wywolania zewnetrzne nie cofaja sie) - nigdy produkcja.
-- ============================================================================
BEGIN;
SET LOCAL statement_timeout = '30min';
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE obs_rpc (fn text, keys text[], role text, enforced text, via text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_table (rel text, op text, role text, enforced text, cols text[], star boolean, via text, file text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_filter (rel text, col text, embed text, method text, op text, role text, via text, file text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_stmt (rel text, op text, role text, cols text[], star boolean, payload text[], where_cols text[], conflict text[], via text, site text, func text) ON COMMIT DROP;

${valuesBlock("obs_rpc", "fn, keys, role, enforced, via, site, func", rpcRows)}
${valuesBlock("obs_table", "rel, op, role, enforced, cols, star, via, file, site, func", tableRows)}
${valuesBlock("obs_filter", "rel, col, embed, method, op, role, via, file, site, func", filterRows)}
${valuesBlock("obs_stmt", "rel, op, role, cols, star, payload, where_cols, conflict, via, site, func", statementRows)}
${RPC_MATCH_SQL}
-- Kolumny filtrow: cel konfliktu bez onConflict (col NULL) = klucz glowny.
CREATE TEMP VIEW obs_filter_cols AS
SELECT f.rel, coalesce(f.col, pk.col) AS col, f.embed, f.method, f.op, f.role, f.via, f.file, f.site, f.func
  FROM obs_filter f
  LEFT JOIN LATERAL (
    SELECT a.attname::text AS col
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])
     WHERE i.indrelid = ${rel("f.rel")} AND i.indisprimary
  ) pk ON f.col IS NULL;

CREATE TEMP TABLE obs_violation ON COMMIT DROP AS
SELECT DISTINCT kind, site, func, rel, col, role, enforced, problem, via FROM (
  SELECT 'rpc' AS kind, r.site, r.func, r.fn AS rel, coalesce(array_to_string(r.keys, ','), '?') AS col,
         r.role, r.enforced,
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = r.fn)
              THEN 'funkcja nie istnieje'
              WHEN r.keys IS NOT NULL AND pg_temp.ts_rpc_match(r.fn, r.keys) IS NULL
              THEN 'brak przeciazenia dla tych kluczy'
              ELSE 'brak EXECUTE' END AS problem,
         r.via
    FROM obs_rpc r
   WHERE (r.keys IS NOT NULL AND pg_temp.ts_rpc_match(r.fn, r.keys) IS NULL)
      OR (r.keys IS NULL AND NOT EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = r.fn))
      OR (r.role IN ${roles} AND (
            (r.keys IS NOT NULL AND pg_temp.ts_rpc_match(r.fn, r.keys) IS NOT NULL
             AND NOT has_function_privilege(r.role, pg_temp.ts_rpc_match(r.fn, r.keys), 'EXECUTE'))
            OR (r.keys IS NULL AND NOT EXISTS (
                  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname = r.fn
                     AND has_function_privilege(r.role, p.oid, 'EXECUTE')))))
  UNION ALL
  SELECT CASE WHEN t.op = 'select' THEN 'select-column' ELSE 'write' END, t.site, t.func, t.rel,
         coalesce(c.col, '*'), t.role, t.enforced,
         CASE WHEN ${rel("t.rel")} IS NULL THEN 'relacja nie istnieje'
              WHEN c.col IS NOT NULL AND NOT EXISTS (
                     SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = ${rel("t.rel")} AND a.attname = c.col
                        AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'kolumna nie istnieje'
              ELSE 'brak ' || priv.p END,
         t.via
    FROM obs_table t
    LEFT JOIN LATERAL (
      SELECT a.attname::text AS col FROM pg_attribute a
       WHERE a.attrelid = ${rel("t.rel")} AND a.attnum > 0 AND NOT a.attisdropped
         AND (t.star OR a.attname = ANY (t.cols))
      UNION
      SELECT x FROM unnest(t.cols) x
    ) c ON true
    LEFT JOIN LATERAL unnest(CASE t.op
        WHEN 'select' THEN ARRAY['SELECT']
        WHEN 'insert' THEN ARRAY['INSERT']
        WHEN 'update' THEN ARRAY['UPDATE']
        WHEN 'upsert' THEN ARRAY['INSERT', 'UPDATE']
        WHEN 'upsert_ignore' THEN ARRAY['INSERT']
        ELSE ARRAY[NULL]::text[] END) AS priv(p) ON true
   WHERE ${rel("t.rel")} IS NULL
      OR (c.col IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = ${rel("t.rel")} AND a.attname = c.col
               AND a.attnum > 0 AND NOT a.attisdropped))
      OR (t.role IN ${roles} AND priv.p IS NOT NULL AND c.col IS NOT NULL
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = ${rel("t.rel")} AND a.attname = c.col
                         AND a.attnum > 0 AND NOT a.attisdropped)
          AND NOT has_column_privilege(t.role, ${rel("t.rel")}, c.col, priv.p))
  UNION ALL
  SELECT 'write', t.site, t.func, t.rel, '*', t.role, t.enforced, 'brak DELETE', t.via
    FROM obs_table t
   WHERE t.op = 'delete' AND t.role IN ${roles} AND ${rel("t.rel")} IS NOT NULL
     AND NOT has_table_privilege(t.role, ${rel("t.rel")}, 'DELETE')
  UNION ALL
  SELECT 'filter-column', f.site, f.func, f.rel, coalesce(f.col, '(klucz glowny?)'), f.role, 'unknown',
         CASE WHEN ${rel("f.rel")} IS NULL THEN 'relacja nie istnieje'
              WHEN f.col IS NULL THEN 'brak klucza glownego'
              WHEN NOT EXISTS (SELECT 1 FROM pg_attribute a
                                WHERE a.attrelid = ${rel("f.rel")} AND a.attname = f.col
                                  AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'kolumna nie istnieje'
              ELSE 'brak SELECT' END
           || ' (' || f.method || coalesce(', osadzenie ' || f.embed, '') || ', ' || f.op
           || CASE WHEN f.file <> f.site THEN ', literal w ' || f.file ELSE '' END || ')',
         f.via
    FROM obs_filter_cols f
   WHERE ${rel("f.rel")} IS NULL
      OR f.col IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = ${rel("f.rel")} AND a.attname = f.col
                        AND a.attnum > 0 AND NOT a.attisdropped)
      OR (f.role IN ${roles}
          AND NOT has_column_privilege(f.role, ${rel("f.rel")}, f.col, 'SELECT'))
) v;
${PROBE_SQL}
SELECT p.kind, coalesce(p.outcome, 'nie uruchomiona') AS outcome, count(*) AS probes
  FROM obs_probe p
 GROUP BY 1, 2
 ORDER BY 1, 2;

SELECT kind, site, func, rel, col, role, enforced, problem, via, caught_by FROM (
  SELECT kind, site, func, rel, col, role, enforced, problem, via, 'privilege-check' AS caught_by
    FROM obs_violation
  UNION ALL
  SELECT DISTINCT p.kind, p.site, p.func, p.rel, p.cols, p.role, 'unknown',
         p.msg || CASE WHEN EXISTS (SELECT 1 FROM obs_violation v
                                     WHERE v.site = p.site AND v.func = p.func
                                       AND v.rel = p.rel AND v.role = p.role)
                       THEN '' ELSE ' (tylko sonda)' END,
         p.via, 'execution-probe'
    FROM obs_probe p
   WHERE p.outcome = 'brak uprawnienia'
) x
ORDER BY caught_by DESC, kind, site, func, rel, col, role;
ROLLBACK;
`;
}

/**
 * Sondy wykonania miary (opis w `renderObservedQueries`): tabela `obs_probe`
 * z instrukcją każdej sondy, jej wykonanie jako rola zmierzona w podtransakcji
 * kończonej wyjątkiem wartownika i klasyfikacja wyniku.
 */
const PROBE_SQL = `-- ── Sondy wykonania ─────────────────────────────────────────────────────────
CREATE TEMP TABLE obs_probe (
  id serial PRIMARY KEY, kind text, site text, func text, rel text, cols text,
  role text, via text, sql text, state text, msg text, ctx text, outcome text
) ON COMMIT DROP;

-- Lista identyfikatorow wedlug formatu (\`%I\`, \`%1$I = EXCLUDED.%1$I\`, \`DEFAULT\`).
CREATE FUNCTION pg_temp.ts_list(p_items text[], p_fmt text, p_sep text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT string_agg(format(p_fmt, x), p_sep ORDER BY o) FROM unnest(p_items) WITH ORDINALITY u(x, o)
$f$;

CREATE FUNCTION pg_temp.ts_pk(p_rel text)
RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT array_agg(a.attname::text ORDER BY k.o)
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, o)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indrelid = to_regclass('public.' || quote_ident(p_rel)) AND i.indisprimary
$f$;

-- Argumenty wywolania RPC z NULL-ami: klucze z kodu (nazwane), a gdy kluczy nie
-- da sie ustalic - kazdy parametr bez DEFAULT; jedyny nienazwany parametr
-- (json PostgREST) - pozycyjnie.
CREATE FUNCTION pg_temp.ts_rpc_args(p_oid oid, p_keys text[])
RETURNS text LANGUAGE plpgsql STABLE AS $f$
DECLARE
  p pg_proc;
  v_types oid[];
  v_names text[];
  v_modes text[];
  v_out text[] := '{}';
  v_pos int := 0;
  i int;
BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid = p_oid;
  -- \`oidvector\` liczy od 0 - przepisanie do tablicy od 1, jak nazwy i tryby.
  v_types := coalesce(p.proallargtypes, ARRAY(SELECT unnest(p.proargtypes::oid[])));
  v_names := coalesce(p.proargnames, array_fill(''::text, ARRAY[cardinality(v_types)]));
  v_modes := coalesce(p.proargmodes::text[], array_fill('i'::text, ARRAY[cardinality(v_types)]));
  FOR i IN 1 .. coalesce(cardinality(v_types), 0) LOOP
    CONTINUE WHEN v_modes[i] NOT IN ('i', 'b', 'v');
    v_pos := v_pos + 1;
    IF coalesce(v_names[i], '') = '' THEN
      CONTINUE WHEN v_pos > p.pronargs - p.pronargdefaults;
      v_out := v_out || format('NULL::%s', format_type(v_types[i], NULL));
    ELSIF (p_keys IS NOT NULL AND v_names[i] = ANY (p_keys))
       OR (p_keys IS NULL AND v_pos <= p.pronargs - p.pronargdefaults) THEN
      v_out := v_out || format('%s%I => NULL::%s', CASE WHEN v_modes[i] = 'v' THEN 'VARIADIC ' ELSE '' END,
                               v_names[i], format_type(v_types[i], NULL));
    END IF;
  END LOOP;
  RETURN array_to_string(v_out, ', ');
END $f$;

-- Zapytania lancuchow: odczyt jako SELECT ... LIMIT 0, zapis jako EXPLAIN.
INSERT INTO obs_probe (kind, site, func, rel, cols, role, via, sql)
SELECT 'probe-' || s.op, s.site, s.func, s.rel,
       concat_ws(' ', CASE WHEN s.star THEN '*' ELSE array_to_string(s.cols, ',') END,
                 nullif('ladunek(' || array_to_string(s.payload, ',') || ')', 'ladunek()'),
                 nullif('where(' || array_to_string(s.where_cols, ',') || ')', 'where()')),
       s.role, s.via,
       CASE s.op
         WHEN 'select' THEN format('SELECT %s FROM public.%I%s LIMIT 0',
           CASE WHEN s.star THEN '*' ELSE coalesce(pg_temp.ts_list(s.cols, '%I', ', '), '') END,
           s.rel, w.clause)
         WHEN 'delete' THEN format('EXPLAIN DELETE FROM public.%I%s%s', s.rel, w.clause, r.clause)
         WHEN 'update' THEN format('EXPLAIN UPDATE public.%I SET %s%s%s', s.rel,
           pg_temp.ts_list(s.payload, '%I = DEFAULT', ', '), w.clause, r.clause)
         ELSE format('EXPLAIN INSERT INTO public.%I %s%s%s', s.rel,
           CASE WHEN cardinality(s.payload) = 0 THEN 'DEFAULT VALUES'
                ELSE format('(%s) VALUES (%s)', pg_temp.ts_list(s.payload, '%I', ', '),
                            pg_temp.ts_list(s.payload, 'DEFAULT', ', ')) END,
           CASE WHEN s.op = 'insert' THEN ''
                WHEN t.cols IS NULL THEN ' ON CONFLICT DO NOTHING'
                WHEN s.op = 'upsert_ignore' OR cardinality(s.payload) = 0
                THEN format(' ON CONFLICT (%s) DO NOTHING', t.cols)
                ELSE format(' ON CONFLICT (%s) DO UPDATE SET %s', t.cols,
                            pg_temp.ts_list(s.payload, '%1$I = EXCLUDED.%1$I', ', ')) END,
           r.clause)
       END
  FROM obs_stmt s
  CROSS JOIN LATERAL (SELECT coalesce(' WHERE ' || pg_temp.ts_list(s.where_cols, '%I IS NULL', ' AND '), '') AS clause) w
  CROSS JOIN LATERAL (SELECT CASE WHEN s.star THEN ' RETURNING *'
                                  ELSE coalesce(' RETURNING ' || pg_temp.ts_list(s.cols, '%I', ', '), '') END AS clause) r
  CROSS JOIN LATERAL (SELECT pg_temp.ts_list(CASE WHEN s.conflict = ARRAY['${PRIMARY_KEY_COLUMNS}']
                                                  THEN pg_temp.ts_pk(s.rel) ELSE s.conflict END,
                                             '%I', ', ') AS cols) t
 WHERE s.role IN ('anon', 'authenticated', 'service_role')
   AND to_regclass('public.' || quote_ident(s.rel)) IS NOT NULL;

-- Kazda kolumna filtra osobno (takze osadzenia i budowniczy przez wartosc).
INSERT INTO obs_probe (kind, site, func, rel, cols, role, via, sql)
SELECT DISTINCT 'probe-filter', f.site, f.func, f.rel, f.col, f.role, f.via,
       format('SELECT FROM public.%I WHERE %I IS NULL LIMIT 0', f.rel, f.col)
  FROM obs_filter_cols f
 WHERE f.role IN ('anon', 'authenticated', 'service_role') AND f.col IS NOT NULL
   AND to_regclass('public.' || quote_ident(f.rel)) IS NOT NULL;

-- RPC: funkcje SECURITY INVOKER wolane przez anon/authenticated, z EXECUTE
-- (brak EXECUTE zglasza juz sprawdzenie uprawnien).
INSERT INTO obs_probe (kind, site, func, rel, cols, role, via, sql)
SELECT DISTINCT 'probe-rpc', r.site, r.func, r.fn, coalesce(array_to_string(r.keys, ','), '?'),
       r.role, r.via, format('SELECT public.%I(%s)', p.proname, pg_temp.ts_rpc_args(p.oid, r.keys))
  FROM obs_rpc r
  JOIN pg_proc p ON p.oid IN (
         SELECT pg_temp.ts_rpc_match(r.fn, r.keys) WHERE r.keys IS NOT NULL
         UNION ALL
         SELECT q.oid FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
          WHERE r.keys IS NULL AND n.nspname = 'public' AND q.proname = r.fn)
 WHERE r.role IN ('anon', 'authenticated')
   AND NOT p.prosecdef AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype
   AND has_function_privilege(r.role, p.oid, 'EXECUTE');

DO $probe$
DECLARE
  r record;
  v_state text;
  v_msg text;
  v_ctx text;
  v_sub text;
  v_email text;
  v_host text;
BEGIN
  -- Wiarygodne roszczenia: administrator z seeda (najdalej w kod funkcji),
  -- inaczej pierwszy uzytkownik; host domyslnego najemcy dla anon.
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    EXECUTE $q$SELECT user_id::text FROM public.user_roles WHERE role::text = 'admin' ORDER BY user_id LIMIT 1$q$ INTO v_sub;
  END IF;
  IF v_sub IS NULL AND to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $q$SELECT id::text FROM auth.users ORDER BY id LIMIT 1$q$ INTO v_sub;
  END IF;
  v_sub := coalesce(v_sub, '00000000-0000-4000-8000-000000000001');
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $q$SELECT email::text FROM auth.users WHERE id::text = $1$q$ INTO v_email USING v_sub;
  END IF;
  IF to_regclass('public.tenants') IS NOT NULL THEN
    EXECUTE $q$SELECT domain FROM public.tenants ORDER BY is_default DESC NULLS LAST, created_at LIMIT 1$q$ INTO v_host;
  END IF;
  FOR r IN SELECT id, role, sql FROM obs_probe ORDER BY id LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims',
        CASE WHEN r.role = 'authenticated'
             THEN json_build_object('sub', v_sub, 'role', r.role, 'aud', 'authenticated', 'email', v_email)
             ELSE json_build_object('role', r.role) END::text, true);
      PERFORM set_config('request.jwt.claim.sub', CASE WHEN r.role = 'authenticated' THEN v_sub ELSE '' END, true);
      PERFORM set_config('request.jwt.claim.role', r.role, true);
      PERFORM set_config('request.headers', json_build_object('x-tenant-host', v_host)::text, true);
      PERFORM set_config('role', r.role, true);
      EXECUTE r.sql;
      -- Wartownik: wycofuje podtransakcje (zapisy funkcji, role, roszczenia).
      RAISE SQLSTATE 'PRB00';
    EXCEPTION
      WHEN SQLSTATE 'PRB00' THEN
        v_state := '00000'; v_msg := NULL; v_ctx := NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    END;
    UPDATE obs_probe SET state = v_state, msg = v_msg, ctx = left(v_ctx, 400),
           outcome = CASE WHEN v_state = '00000' THEN 'ok'
                          WHEN v_state = '42501' AND v_msg LIKE 'permission denied for %' THEN 'brak uprawnienia'
                          WHEN v_state = '42501' THEN 'odmowa autoryzacji (RAISE 42501)'
                          ELSE 'inny blad ' || v_state END
     WHERE id = r.id;
  END LOOP;
END
$probe$;
`;
