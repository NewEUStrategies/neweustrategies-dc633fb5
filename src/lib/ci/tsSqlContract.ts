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
// MIARA W BRAMCE (`SeamFacts.observed`). Do listopada 2026 dwie luki tej
// bramki były tylko MIERZONE (`generate:ts-sql-contract --measure`) - i to
// miara, nie CI, złapała defekty tego miesiąca. Teraz fakty miary idą do
// pgTAP (asercje 10-20, sekcja „Bramka z miary" niżej):
//   * kolumny filtrów i sortowania (`.eq/.in/.or("a.eq.x")/.match/.order`...)
//     i celu upsertu - istnienie i SELECT roli. Postgres wymaga SELECT na
//     kolumnie z WHERE/ORDER BY także w UPDATE i DELETE, więc filtr po kolumnie
//     bez grantu daje 42501 tak samo jak odczyt;
//   * rola klienta szerzej niż reguły bramki: fabryki klienta serwisowego
//     (`await admin()`), `createClient(…, klucz)`, `const x = ...`
//     i parametr klienta - przez WSZYSTKIE wywołania funkcji (inaczej
//     `unknown`; nigdy zgadywanie); fakt z rolą nieustaloną - wyłącznie
//     z wpisem `UNKNOWN_ROLE_REVIEWED`;
//   * zasoby osadzone list `select`, sondy wykonania (widok
//     `security_invoker`, funkcja SECURITY INVOKER) i gość (`anon`) klienta
//     przeglądarki w plikach osiągalnych dla gościa (`guestReach.ts`).
// Fakt bramki zachowuje swoją rolę (`enforcedRole`): asercje 1-9 i ich
// tabele są te same co przed miarą, a rola zmierzona sprawdzana jest tam,
// gdzie się od niej różni.
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
  /**
   * Miara (filtry, rola szerzej, osadzenia, sondy) - asercje 10-20 pgTAP i listy
   * `check:ts-sql-contract`; bez `observe` puste.
   */
  readonly observed: ObservedFacts;
}

// ── Miara (asercje 10-20): typy ─────────────────────────────────────────────

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
  /**
   * Klient przeglądarki (`@/integrations/supabase/client`): rola
   * `authenticated` TYLKO z sesją. Gość (bez logowania), a także KAŻDE
   * wywołanie na serwerze (SSR, loader, handler funkcji serwera - klient bez
   * magazynu sesji) idzie z kluczem publicznym, czyli jako `anon`. Miara
   * sprawdza wtedy OBIE role: wiersz z rolą zmierzoną i drugi z `anon`.
   */
  readonly guest?: boolean;
}

interface ObservedCommon {
  readonly role: MeasuredRole;
  readonly via: string;
  /** Rola, z którą ten fakt idzie do pgTAP (`unknown` = uprawnień bramka nie sprawdza). */
  readonly enforcedRole: ClientRole;
  /** Klient przeglądarki: miara sprawdza też `anon` (`RoleResolution.guest`). */
  readonly guest: boolean;
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
  /**
   * Fakt wstrzymany wpisem `SEAM_FACTS_WITHHELD_REVIEWED`: jego uprawnień
   * kontrakt nie sprawdza - ani rolą bramki, ani zmierzoną, ani gościa.
   */
  readonly withheld: boolean;
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
  /**
   * Rola bramki dla klienta łańcucha: z nią pgTAP sprawdza fakty łańcucha
   * (kolumn filtra bramka nie sprawdza - `enforcedRole` zostaje `unknown`).
   * Budowniczy przez wartość - rola bramki odbiorcy jego `.from()`.
   */
  readonly gateRole: ClientRole;
}

/**
 * Zasób osadzony listy `select` (`rel(...)`, `alias:rel!fk(...)`,
 * `...rel(...)`, także zagnieżdżony). PostgREST czyta go złączeniem z relacją
 * nadrzędną, więc rola łańcucha potrzebuje SELECT na jego kolumnach
 * i kolumnach klucza obcego złączenia. Relację rozwiązuje SQL miary tak jak
 * PostgREST: nazwa relacji, a gdy jej nie ma - nazwa klucza obcego albo
 * kolumny z kluczem obcym relacji nadrzędnej (`autor:author_id(...)`).
 */
export interface ObservedEmbed extends ObservedCommon {
  /** Numer osadzenia (indeks w `observed.embeds`) - do wiązania zagnieżdżeń w SQL. */
  readonly id: number;
  /** Osadzenie nadrzędne (`id`); `null` - pierwszy poziom, rodzicem jest `table`. */
  readonly parentId: number | null;
  /** Tabela łańcucha (`.from`). */
  readonly table: string;
  /** Ścieżka osadzenia w liście `select` (alias albo nazwa, `a.b`). */
  readonly path: string;
  /** Nazwa relacji z listy `select` (tabela, widok, klucz obcy albo jego kolumna). */
  readonly rel: string;
  /** Podpowiedź `!fk` (bez `!inner`/`!left`); `null` - brak. */
  readonly hint: string | null;
  /** Kolumny osadzenia (bez zagnieżdżeń, posortowane). */
  readonly columns: readonly string[];
  readonly star: boolean;
  readonly op: TableOp;
  /** Plik, w którym rozwiązał się literał listy `select`. */
  readonly file: string;
  /** Rola bramki dla klienta łańcucha (osadzeń bramka nie sprawdza - `enforcedRole` `unknown`). */
  readonly gateRole: ClientRole;
}

/**
 * Zapytanie jednego łańcucha budowniczego (łańcuch wprost i - gdy budowniczy
 * trafia do zmiennej - każde jej użycie) do SONDY WYKONANIA miary: sonda
 * wykonuje je jako rola zmierzona (`SELECT … LIMIT 1`, zapis jako `EXPLAIN`),
 * więc łapie odmowę uprawnień WEWNĄTRZ relacji (widok `security_invoker`,
 * podzapytanie polityki RLS, funkcja w kolumnie widoku liczona dla wiersza),
 * której `has_column_privilege` na samej relacji nie widzi.
 */
export interface ObservedStatement {
  readonly table: string;
  readonly op: TableOp;
  readonly role: MeasuredRole;
  /** Rola bramki faktów tego zapytania (różne albo wstrzymane - `unknown`). */
  readonly enforcedRole: ClientRole;
  /** Klient przeglądarki: sonda także jako `anon`. */
  readonly guest: boolean;
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
  /** Zapytanie niesie fakt wstrzymany w przeglądzie - bez sondy wykonania. */
  readonly withheld: boolean;
}

export interface ObservedFacts {
  /** Każdy fakt RPC bramki z rolą zmierzoną (ta sama kolejność co `rpcs`). */
  readonly rpcs: readonly ObservedRpc[];
  /** Każdy fakt tabeli bramki (także wstrzymany) z rolą zmierzoną. */
  readonly tables: readonly ObservedTable[];
  readonly filters: readonly FilterSite[];
  /** Zasoby osadzone list `select` faktów odczytu (bez powtórzeń). */
  readonly embeds: readonly ObservedEmbed[];
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

// ── Miara: rola klienta szerzej ─────────────────────────────────────────────
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
  readonly guest: boolean;
}[] = [
  {
    module: "src/integrations/supabase/client.server.ts",
    name: "supabaseAdmin",
    role: "service_role",
    via: "import supabaseAdmin",
    guest: false,
  },
  {
    module: "src/integrations/supabase/client.ts",
    name: "supabase",
    role: "authenticated",
    via: "import klienta przeglądarki",
    guest: true,
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
  // Klient przeglądarki w KTÓRYMKOLWIEK wywołaniu - zapytanie idzie też jako
  // gość (`anon`); to suma wartości, nie zgadywanie.
  return withGuest(
    { role: distinct[0], via: `${label} <- ${vias.join(" | ")}`.slice(0, MAX_VIA) },
    roles.some((r) => r.guest === true),
  );
}

/**
 * Rola z flagą gościa. `guest` pochodzi WYŁĄCZNIE od klienta przeglądarki
 * (`authenticated`), a zgodność ról wymaga jednej roli - więc gość nigdy nie
 * stoi przy innej roli (test stanu repozytorium pilnuje tego niezmiennika).
 */
function withGuest(role: RoleResolution, guest: boolean | undefined): RoleResolution {
  return guest === true ? { ...role, guest: true } : role;
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
            ...imported,
            via: `wiązanie zamiast reguły nazwy (bramka: ${legacy}): ${imported.via}`.slice(
              0,
              MAX_VIA,
            ),
          };
        }
        if (imported.role === legacy) {
          return withGuest(
            { role: legacy, via: `bramka: ${legacyRoleVia(expr, scope)}` },
            imported.guest,
          );
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
            ...bound,
            via: `wiązanie zamiast reguły nazwy (bramka: ${legacy}): ${bound.via}`.slice(
              0,
              MAX_VIA,
            ),
          };
        }
        return withGuest(
          { role: legacy, via: `bramka: ${legacyRoleVia(expr, scope)}` },
          bound.guest,
        );
      }
    }
    // Reguła nazwy bez wiązania w pliku: `supabase` w pliku z importem klienta
    // przeglądarki to ten klient (gość - `anon`); sam `requireSupabaseAuth`
    // to klient z sesją z żądania.
    return withGuest(
      { role: legacy, via: `bramka: ${legacyRoleVia(expr, scope)}` },
      ts.isIdentifier(node) &&
        node.text === "supabase" &&
        !scope.adminAliases.has("supabase") &&
        scope.browserClient,
    );
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
  if (knownExport !== undefined) {
    return withGuest({ role: knownExport.role, via: knownExport.via }, knownExport.guest);
  }
  const exported = moduleExport(spec, name, scope, env);
  if (exported === null || exported.binding.kind !== "local" || exported.binding.prop !== null) {
    return unknownRole(`import ${name} z ${spec}: nie stała modułu`);
  }
  const inner = measuredRole(exported.binding.init, exported.scope, env, depth + 1);
  return inner.role === "unknown" ? inner : { ...inner, via: `import ${name} <- ${inner.via}` };
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
        : { ...inner, via: `const ${id.text} <- ${inner.via}`.slice(0, MAX_VIA) };
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

// ── Miara: kolumny filtrów i sortowania ─────────────────────────────────────
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
  /** Rola bramki odbiorcy `.from()` / źródła `looseTable` (`receiverRole`). */
  readonly gate: ClientRole;
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
        const gate = looseSourceRole(node.arguments[0], scope, known);
        return [{ table, role, gate, select, op }];
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
        return [
          {
            table,
            role: measuredRole(recv, scope, env.roles, 0),
            gate: receiverRole(recv, scope, known),
            select,
            op,
          },
        ];
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
  /** Miara (`SeamFacts.observed`). */
  observed: {
    rpcs: ObservedRpc[];
    tables: ObservedTable[];
    filters: FilterSite[];
    embeds: ObservedEmbed[];
    /** Klucz osadzenia (z kluczem rodzica) -> `id` - to samo osadzenie tylko raz. */
    embedKeys: Map<string, number>;
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
        const key = `${builder.table}|${builder.role.role}|${builder.role.guest === true}|${builder.gate}|${builder.op}|${builder.select ?? ""}`;
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
            guest: builder.role.guest === true,
            gateRole: builder.gate,
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
    guest: measured.guest === true,
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
      withheld,
      guest: measure.role.guest === true,
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
          if (measure !== null) {
            observeEmbeds(value.text, value.file, table, role, measure.role, call, scope, out);
          }
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
          if (measure !== null) {
            observeEmbeds(select, scope.file, table, role, measure.role, call, scope, out);
          }
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
      role,
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
      role,
      scope.file,
      chainFacts,
      chainFilters,
      out,
    );
  }
}

/**
 * Element listy `select` będący zasobem osadzonym: nazwa w odpowiedzi (alias
 * albo relacja), relacja, podpowiedź `!fk` (`!inner`/`!left` to rodzaj
 * złączenia, nie podpowiedź) i lista wewnętrzna. `null` - kolumna, agregat
 * (`count()`, `kol.sum()`) albo nazwa nieczytelna.
 */
export function selectEmbedItem(
  raw: string,
): { name: string; rel: string; hint: string | null; inner: string } | null {
  const open = raw.indexOf("(");
  if (open === -1 || !raw.endsWith(")")) return null;
  const inner = raw.slice(open + 1, -1);
  if (inner.trim().length === 0) return null;
  let head = raw.slice(0, open).trim();
  if (head.startsWith("...")) head = head.slice(3).trim();
  let alias: string | null = null;
  const colon = head.indexOf(":");
  if (colon !== -1) {
    alias = head.slice(0, colon).trim();
    head = head.slice(colon + 1).trim();
  }
  const [rel, ...mods] = head.split("!").map((x) => x.trim());
  if (!COLUMN_RE.test(rel)) return null;
  const hints = mods.filter((m) => m !== "inner" && m !== "left");
  return { name: alias ?? rel, rel, hint: hints[0] ?? null, inner };
}

/**
 * Miara: zasoby osadzone listy `select` (rekurencyjnie) jako fakty na
 * relacji osadzonej z rolą łańcucha. `count` w liście osadzenia to dawna
 * składnia licznika osadzenia PostgREST (`rel(count)`), nie kolumna.
 */
function observeEmbeds(
  select: string,
  file: string,
  table: string,
  gateRole: ClientRole,
  role: RoleResolution,
  call: ts.CallExpression,
  scope: FileScope,
  out: Collector,
): void {
  const fn = enclosingFunctionPath(call);
  const walk = (list: string, parentId: number | null, prefix: string | null, depth: number) => {
    if (depth > 8) return;
    for (const raw of splitTopLevel(list)) {
      const item = selectEmbedItem(raw);
      if (item === null) continue;
      const parsed = parseSelectColumns(item.inner);
      const columns = parsed.columns.filter((c) => c !== "count");
      const path = prefix === null ? item.name : `${prefix}.${item.name}`;
      const key = JSON.stringify([
        parentId === null ? null : out.observed.embeds[parentId].id,
        scope.file,
        fn,
        table,
        path,
        item.rel,
        item.hint,
        columns,
        parsed.star,
        role.role,
        role.guest === true,
        role.via,
        gateRole,
        file,
      ]);
      let id = out.observed.embedKeys.get(key);
      if (id === undefined) {
        id = out.observed.embeds.length;
        out.observed.embedKeys.set(key, id);
        out.observed.embeds.push({
          id,
          parentId,
          table,
          path,
          rel: item.rel,
          hint: item.hint,
          columns,
          star: parsed.star,
          op: "select",
          role: role.role,
          via: role.via,
          enforcedRole: "unknown",
          guest: role.guest === true,
          gateRole,
          file,
          site: scope.file,
          fn,
        });
      }
      walk(item.inner, id, path, depth + 1);
    }
  };
  walk(select, null, null, 0);
}

/** Metody faktów filtra upsertu: cel `ON CONFLICT` i kolumny `EXCLUDED`. */
const UPSERT_FILTER_METHODS: ReadonlySet<string> = new Set(["onConflict", "upsert(EXCLUDED)"]);

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
  gateRole: ClientRole,
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
    // Filtry tabeli łańcucha (osadzenia - osobne sondy kolumn filtra). Cel
    // `ON CONFLICT` (także znacznik klucza głównego) i kolumny `EXCLUDED` to
    // nie WHERE - także w upsercie z ładunkiem nieczytelnym (bez faktu zapisu,
    // zostaje sam odczyt RETURNING); mają własne sondy kolumn filtra.
    const where = unique(
      gFilters
        .filter((f) => f.embed === null && !UPSERT_FILTER_METHODS.has(f.method))
        .map((f) => f.column),
    );
    const target = unique(gFilters.filter((f) => f.method === "onConflict").map((f) => f.column));
    const selects = gFacts.filter((f) => f.op === "select");
    const columns = unique(selects.flatMap((f) => f.columns));
    const star = selects.some((f) => f.star);
    const writes = gFacts.filter((f) => f.op !== "select");
    // Rola bramki zapytania: rola, z którą pgTAP sprawdza jego fakty (fakt
    // wstrzymany - `unknown`); bez faktów (sam `head: true` i filtry) - rola
    // bramki klienta łańcucha.
    const enforcedOf = (fs: readonly ObservedTable[]): ClientRole => {
      const roles = [...new Set(fs.map((f) => f.enforcedRole))];
      return fs.length === 0 ? gateRole : roles.length === 1 ? roles[0] : "unknown";
    };
    const guest = role.guest === true;
    const statements: ObservedStatement[] =
      writes.length === 0
        ? selects.length === 0 && where.length === 0
          ? []
          : [
              {
                table,
                op: "select",
                role: role.role,
                enforcedRole: enforcedOf(selects),
                guest,
                via: role.via,
                site,
                fn,
                columns,
                star,
                payload: [],
                where,
                conflict: null,
                withheld: selects.some((f) => f.withheld),
              },
            ]
        : writes.map((w) => {
            const upsert = w.op === "upsert" || w.op === "upsert_ignore";
            return {
              table,
              op: w.op,
              role: role.role,
              enforcedRole: enforcedOf([w, ...selects]),
              guest,
              via: role.via,
              site,
              fn: w.fn,
              columns,
              star,
              payload: w.columns,
              where: w.op === "update" || w.op === "delete" ? where : [],
              // Cel nieczytelny (`[]`) - sonda bez celu (`ON CONFLICT DO NOTHING`), nie zgadujemy klucza.
              conflict: upsert ? target : null,
              withheld: [w, ...selects].some((f) => f.withheld),
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
  gateRole: ClientRole,
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
          guest: measure.role.guest === true,
          gateRole,
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
     * Miara (`observed`): kolumny filtrów, rola szerzej, osadzenia, zapytania
     * sond. Bramka CI (`generate:ts-sql-contract`, `--check`) liczy ją zawsze;
     * bez niej `observed` jest puste, a fakty bramki - te same.
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
      embeds: [],
      embedKeys: new Map(),
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
      embeds: out.observed.embeds,
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
  /**
   * Sprawdzenia miary w bramce (lista ról nieustalonych, lista gościa,
   * zapadki filtrów) - wymagają faktów z `observe: true`. Pominięte - tylko
   * zasięg ekstrakcji (testy jednostkowe na wycinkach kodu).
   */
  observed?: ObservedCoverage,
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
  if (observed !== undefined) problems.push(...observedCoverageProblems(facts, observed));
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

// ── Bramka z miary: rola zmierzona, filtry, osadzenia, sondy i gość ─────────
//
// Do listopada 2026 miara (`observed`) była poza bramką i to ona - nie CI -
// złapała całą klasę defektów tego miesiąca: `.order("views_count")` na
// nieistniejącej kolumnie archiwum, `profiles.email` czytane klientem
// użytkownika w zamówieniach biletowych i w „moim bilecie" (rola klienta
// nieznana bramce: parametr pomocnika), `builder_templates` i osadzenie
// `profiles(...)` czytane klientem przeglądarki przez GOŚCIA, widoki
// `security_invoker` i funkcje SECURITY INVOKER czytające kolumny bez grantu
// (`crm_funnel_view`, `crm_companies_aggregates` - widzi je dopiero sonda
// wykonania). Teraz te fakty idą do pgTAP (asercje 10-20, `renderContractTest`):
//   * rola ZMIERZONA (szerzej niż reguły bramki, nigdy zgadywana) zamiast
//     `unknown` - tam, gdzie się różni od roli bramki; fakty z rolą wciąż
//     nieustaloną wolno mieć WYŁĄCZNIE na liście `UNKNOWN_ROLE_REVIEWED`,
//   * kolumny filtrów, sortowania i celu upsertu oraz zasoby osadzone list
//     `select` - istnienie i SELECT roli,
//   * sondy wykonania (zapytanie jako rola w podtransakcji, wycofane),
//   * gość (`anon`) - każdy fakt klienta przeglądarki w pliku osiągalnym dla
//     gościa (`guestReach`: klasa `public` albo `none`); `admin`
//     i `session-gate` wyłączone strukturalnie, `public` tylko po zalogowaniu -
//     WYŁĄCZNIE wpisem `GUEST_LOGIN_ONLY_REVIEWED` z dowodem bramki.
// Miejsca, których miara nie umie przeczytać (filtry nieczytelne, filtry poza
// rozpoznanym budowniczym), mają zapadki - ich liczba nie rośnie po cichu.

/** Role klienta, których uprawnienia sprawdza Postgres (`unknown` - tylko istnienie). */
const CLIENT_ROLES: ReadonlySet<MeasuredRole> = new Set(["anon", "authenticated", "service_role"]);

/**
 * Zapadka filtrów nieczytelnych (`observed.unresolvedFilters`): kolumna,
 * tabela albo osadzenie filtra znane dopiero w czasie działania (`.order(col)`
 * z parametru, `.or(warunek)` składany w pętli, `.from(table)` z wyboru) -
 * kolumn takiego filtra kontrakt nie sprawdza. Liczba może TYLKO maleć: nowe
 * takie miejsce czerwieni `check:ts-sql-contract`. Naprawa: kolumna w literale
 * (albo stałej modułu); gdy się nie da - podniesienie zapadki w przeglądzie.
 */
export const MAX_UNRESOLVED_FILTER_SITES = 64;

/**
 * Zapadka wywołań w kształcie filtra PostgREST na odbiorcy, którego ekstrakcja
 * nie wiąże z budowniczym (`observed.filtersOutsideChains`: parametr
 * pomocnika bez widocznych wywołań, wynik funkcji spoza reguł) - szacunek luki
 * po samym kształcie wywołania. Liczba może TYLKO maleć.
 */
export const MAX_FILTERS_OUTSIDE_CHAINS = 8;

/** Klucz listy ról nieustalonych: plik wywołania, ścieżka funkcji, `.rpc(fn)` albo `.from(tabela)`. */
export function unknownRoleKey(site: string, fn: string, call: string): string {
  return `${site}: ${fn}: ${call}`;
}

/**
 * Wszechświat ról nieustalonych: fakty RPC i tabel z rolą zmierzoną `unknown`
 * (liczone) oraz łańcuchy z taką rolą bez faktu tabeli (sam filtr, zapytanie
 * sondy, osadzenie) - klucz musi być na liście, liczba faktów może być 0.
 */
function unknownRoleUniverse(facts: SeamFacts): Map<string, number> {
  const o = facts.observed;
  const out = new Map<string, number>();
  const add = (key: string, n: number): void => {
    out.set(key, (out.get(key) ?? 0) + n);
  };
  for (const r of o.rpcs) {
    if (r.role === "unknown") add(unknownRoleKey(r.site, r.fn, `.rpc(${r.name})`), 1);
  }
  for (const t of o.tables) {
    if (t.role === "unknown") add(unknownRoleKey(t.site, t.fn, `.from(${t.table})`), 1);
  }
  for (const x of [...o.filters.filter((f) => f.embed === null), ...o.statements, ...o.embeds]) {
    if (x.role === "unknown") add(unknownRoleKey(x.site, x.fn, `.from(${x.table})`), 0);
  }
  return out;
}

const NOT_EVERY_REFERENCE =
  "klient z parametru funkcji, której nie każde odwołanie jest widocznym wywołaniem (`const { f } = await import(...)`, funkcja w tablicy źródeł albo obiekcie pomocników, callback) - reguła parametru nie zna wszystkich klientów, więc rola faktu byłaby zgadywaniem";
const MIXED_CALLERS =
  "parametr klienta, który wywołania podają z RÓŻNYMI rolami (sesja użytkownika i `service_role`, albo z rolą nieustaloną) - jedna rola faktu byłaby zgadywaniem; każdy wołający ma własne fakty, ten zostaje bez uprawnień";
const MEMO_CLIENT =
  "klient z pamięci modułu przypisywanej leniwie (`serviceClientMemo.client`, `let cachedPublicClient`), także przez parametr pomocnika albo wartość domyślną - wiązanie przypisywane, reguła roli go nie śledzi";
const HOST_ANON_CLIENT =
  "`hostAnonClient(bearer)` składa `createClient(url, klucz publiczny)` z opcjonalnym `Authorization` wołającego - `anon` albo `authenticated` zależnie od sesji żądania, więc rola jednego faktu nie istnieje";
const LET_CLIENT =
  "klient w `let` ustawianym w gałęziach (`let admin` / `let client` przypisywane warunkowo) - reguła roli śledzi tylko `const` i pojedyncze `=`";
const MEMBER_CLIENT =
  "klient z pola obiektu albo instancji (`this.supabase`, `.client` wyniku `callerSupabase()`, element rozkładu `Promise.all`) - reguła roli nie czyta pól wyniku funkcji";

/**
 * Fakty, których rola klienta jest NIEUSTALONA także dla miary (parametr
 * pomocnika z różnymi wołającymi, klient z pamięci modułu, funkcja jako
 * wartość) - pgTAP sprawdza ich istnienie, a uprawnienia wyłącznie wtedy,
 * gdy rolę dała reguła bramki (asercje 2 i 5; dziś tak jest tylko
 * w `ticket.server.ts`, gdzie reguła nazwy mówi `authenticated`). Klucz: plik
 * wywołania, ścieżka funkcji i `.rpc(fn)` / `.from(tabela)`; wartość: ile
 * faktów RPC i tabel (łańcuch bez faktu - 0) i dlaczego. Lista może TYLKO
 * maleć: nowy fakt z rolą nieustaloną (albo nowy w znanym kluczu) czerwieni
 * `check:ts-sql-contract`, a wpis, któremu ubyło faktów - też (zdejmij go
 * albo zmniejsz licznik). Naprawa: klient wprost (`supabaseAdmin`, klient
 * przeglądarki, `context.supabase`) albo parametr z jedną rolą we wszystkich
 * wywołaniach.
 */
export const UNKNOWN_ROLE_REVIEWED: Readonly<
  Record<string, readonly [count: number, reason: string]>
> = {
  "src/lib/analytics/semantic/revenueSnapshot.functions.ts: clubs: .rpc(admin_revenue_clubs_summary)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/analytics/semantic/revenueSnapshot.functions.ts: email: .rpc(admin_revenue_email_health)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/analytics/semantic/revenueSnapshot.functions.ts: events: .rpc(admin_revenue_events_summary)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/analytics/semantic/revenueSnapshot.functions.ts: funnel: .rpc(admin_revenue_funnel)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/analytics/semantic/revenueSnapshot.functions.ts: snapshot: .rpc(admin_revenue_semantic_snapshot)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/billing/catalogAutoSync.server.ts: recordManualSync: .from(payment_integration_state)": [
    1,
    MEMBER_CLIENT,
  ],
  "src/lib/billing/checkoutSettings.server.ts: loadCheckoutSettings: .from(checkout_settings)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/billing/couponRpc.server.ts: releaseCouponForUser: .rpc(release_b2b_coupon)": [
    1,
    MIXED_CALLERS,
  ],
  "src/lib/email/queueDrain.server.ts: alreadySent: .from(email_send_log)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/queueDrain.server.ts: deleteMessage: .rpc(delete_email)": [1, NOT_EVERY_REFERENCE],
  "src/lib/email/queueDrain.server.ts: loadConfig: .from(email_send_state)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/queueDrain.server.ts: loadFailedAttempts: .from(email_send_log)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/queueDrain.server.ts: logSend: .from(email_send_log)": [1, NOT_EVERY_REFERENCE],
  "src/lib/email/queueDrain.server.ts: moveToDlq: .rpc(move_to_dlq)": [1, NOT_EVERY_REFERENCE],
  "src/lib/email/queueDrain.server.ts: readBatch: .rpc(read_email_batch)": [1, NOT_EVERY_REFERENCE],
  "src/lib/email/queueDrain.server.ts: recheckAccountBound: .rpc(email_queue_send_recheck)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/queueDrain.server.ts: startCooldown: .from(email_send_state)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/recipient-name.server.ts: resolveRecipientName: .from(name_dictionary)": [
    1,
    MEMO_CLIENT,
  ],
  "src/lib/email/recipient-name.server.ts: resolveRecipientName: .from(newsletter_subscribers)": [
    1,
    MEMO_CLIENT,
  ],
  "src/lib/email/suppression.server.ts: applyDeliveryEvent: .rpc(email_apply_delivery_event)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/suppression.server.ts: fetchSuppressedEmails: .rpc(email_filter_suppressed)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/suppression.server.ts: isEmailSuppressed: .rpc(email_is_suppressed)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/suppression.server.ts: recordSuppression: .rpc(email_record_suppression)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/suppression.server.ts: releaseUnsubscribeOnOptIn: .from(email_suppressions)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/email/suppression.server.ts: resolveAccountTenantForAddress: .rpc(email_account_tenant_for_address)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/email/suppression.server.ts: resolveTenantForAddress: .rpc(email_resolve_tenant_for_address)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/email/suppression.server.ts: unsubscribeByToken.call: .rpc(email_unsubscribe_by_token)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/email/transactional.server.ts: alreadyHandled: .from(email_send_log)": [1, MEMO_CLIENT],
  "src/lib/email/transactional.server.ts: enqueueRawEmail: .from(email_send_log)": [2, MEMO_CLIENT],
  "src/lib/email/transactional.server.ts: enqueueRawEmail: .rpc(enqueue_email)": [1, MEMO_CLIENT],
  "src/lib/email/transactional.server.ts: sendTxEmail: .from(email_send_log)": [2, MEMO_CLIENT],
  "src/lib/email/transactional.server.ts: sendTxEmail: .rpc(enqueue_email)": [1, MEMO_CLIENT],
  "src/lib/email/transactional.server.ts: suppressionGate: .from(email_send_log)": [1, MEMO_CLIENT],
  "src/lib/email/txOverrides.server.ts: loadTxOverrides: .from(site_settings)": [1, MIXED_CALLERS],
  "src/lib/email/unsubscribeToken.server.ts: ensureUnsubscribeToken: .from(email_unsubscribe_tokens)":
    [4, MEMO_CLIENT],
  "src/lib/events/eventConsent.server.ts: listMyEventConsentsForCaller: .rpc(event_my_consent_state)":
    [1, MEMBER_CLIENT],
  "src/lib/events/eventRegistration.server.ts: attachAttribution: .rpc(event_registration_attribution_attach)":
    [1, HOST_ANON_CLIENT],
  "src/lib/events/eventRegistration.server.ts: legacyRegister: .rpc(event_register)": [
    1,
    HOST_ANON_CLIENT,
  ],
  "src/lib/events/groupGuests.server.ts: legacyRegisterGuests: .rpc(event_register_group_guests)": [
    1,
    HOST_ANON_CLIENT,
  ],
  "src/lib/events/groupTicketCodes.server.ts: notifyPayload: .rpc(event_registration_notify_payload)":
    [1, HOST_ANON_CLIENT],
  "src/lib/events/registrationSelfNotify.server.ts: notifyPayload: .rpc(event_registration_notify_payload)":
    [1, HOST_ANON_CLIENT],
  "src/lib/events/ticket.server.ts: assertSeatAvailable: .from(event_rsvps)": [1, MIXED_CALLERS],
  "src/lib/events/ticket.server.ts: legacySeatsFor: .from(events)": [1, MIXED_CALLERS],
  "src/lib/events/ticket.server.ts: legacySeatsFor: .rpc(get_event_rsvp_counts)": [
    1,
    MIXED_CALLERS,
  ],
  "src/lib/events/ticket.server.ts: seatsFor: .rpc(event_seat_state)": [1, MIXED_CALLERS],
  "src/lib/events/ticketCodeNotify.server.ts: issueAndSendTicketCodes: .rpc(_event_issue_ticket_codes)":
    [1, LET_CLIENT],
  "src/lib/events/ticketCodeNotify.server.ts: issueAndSendTicketCodes: .rpc(_event_ticket_code_confirm)":
    [1, LET_CLIENT],
  "src/lib/events/wallet/walletRoutes.server.ts: loadTicket: .rpc(event_ticket_wallet_payload)": [
    1,
    LET_CLIENT,
  ],
  "src/lib/menus/refResolution.ts: fetchCategories: .from(categories)": [1, MEMO_CLIENT],
  "src/lib/menus/refResolution.ts: fetchPagePaths: .rpc(page_full_paths)": [1, MEMO_CLIENT],
  "src/lib/menus/refResolution.ts: fetchTags: .from(tags)": [1, MEMO_CLIENT],
  "src/lib/menus/refResolution.ts: truncatedTops: .from(pages)": [1, MEMO_CLIENT],
  "src/lib/privacy/measurementStatus.server.ts: fetchMeasuredEmails: .rpc(email_measurement_status)":
    [1, NOT_EVERY_REFERENCE],
  "src/lib/server/linkCheck.server.ts: maybeAlertBrokenLinks: .from(outbound_link_alerts)": [
    3,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/linkCheck.server.ts: maybeAlertBrokenLinks: .from(outbound_link_checks)": [
    0,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/linkCheck.server.ts: maybeAlertBrokenLinks: .from(user_roles)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/linkCheck.server.ts: runLinkCheckBatch: .from(outbound_link_checks)": [
    2,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/linkCheck.server.ts: runLinkCheckBatch: .from(posts)": [2, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: events: .from(events)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: experts: .from(author_profiles)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/sitemapEntries.server.ts: experts: .from(profile_badges)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/sitemapEntries.server.ts: experts: .from(profiles)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: podcasts: .from(podcast_shows)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/sitemapEntries.server.ts: podcasts: .from(podcasts)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: posts: .from(posts)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: programs: .from(research_programs)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/sitemapEntries.server.ts: qa: .from(qa_sessions)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: readHomepageReading.work: .from(site_settings)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/sitemapEntries.server.ts: stories: .from(web_stories)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: taxonomy: .from(categories)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: taxonomy: .from(posts)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: taxonomy: .from(tags)": [1, NOT_EVERY_REFERENCE],
  "src/lib/server/sitemapEntries.server.ts: tracker: .from(eu_policy_items)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/server/userTenant.server.ts: readUserTenantId: .from(profiles)": [
    1,
    NOT_EVERY_REFERENCE,
  ],
  "src/lib/wordpress-import.functions.ts: load: .from(wp_import_jobs)": [1, MEMBER_CLIENT],
  "src/lib/wordpress-import.functions.ts: patchJob: .from(wp_import_jobs)": [0, MIXED_CALLERS],
};

/**
 * Rozjazd ról nieustalonych z listą przejrzaną: `fresh` - klucz nowy albo
 * z większą liczbą faktów; `stale` - klucz z mniejszą liczbą albo bez faktu
 * z rolą nieustaloną (naprawiony - zdejmij). Oba czerwienią bramkę.
 */
export function unknownRoleDrift(
  facts: SeamFacts,
  reviewed: Readonly<Record<string, readonly [number, string]>> = UNKNOWN_ROLE_REVIEWED,
): { fresh: string[]; stale: string[] } {
  const universe = unknownRoleUniverse(facts);
  const fresh: string[] = [];
  const stale: string[] = [];
  for (const [key, count] of universe) {
    const entry = reviewed[key];
    if (entry === undefined || count > entry[0]) {
      fresh.push(`${key} (${count}, przejrzanych: ${entry?.[0] ?? "-"})`);
    }
  }
  for (const [key, [allowed]] of Object.entries(reviewed)) {
    const count = universe.get(key);
    if (count === undefined || count < allowed) {
      stale.push(`${key} (${count ?? "brak faktu z rolą nieustaloną"}, przejrzanych: ${allowed})`);
    }
  }
  return { fresh: fresh.sort(), stale: stale.sort() };
}

/**
 * Klasy osiągalności (`guestReach`) WYŁĄCZONE strukturalnie z wierszy gościa:
 * plik wywołania osiągalny wyłącznie z panelu (`/admin`, przekierowanie bez
 * `isStaff`) albo spod bramki sesji. `public` i `none` (plik bez ścieżki
 * z trasy - niepewne, więc sprawdzany) - wiersze `anon` idą do pgTAP.
 */
export const GUEST_EXEMPT_CLASSES: ReadonlySet<string> = new Set(["admin", "session-gate"]);

/** Klucz listy gościa: plik wywołania i ścieżka funkcji. */
export function guestKey(site: string, fn: string): string {
  return `${site}: ${fn}`;
}

/**
 * Funkcje w plikach klasy `public` (osiągalnych z trasy publicznej), które
 * mimo to wykonują się WYŁĄCZNIE z sesją: zapytanie z `enabled: !!user`,
 * komponent renderowany pod `{user && ...}`, handler za `requireSupabaseAuth`.
 * Klasa `public` jest górnym oszacowaniem (`guestReach.ts`), więc takie
 * miejsce czerwieniłoby pgTAP jako gość bez defektu - wpis zdejmuje wiersze
 * `anon` faktów TEJ funkcji, nic poza nimi (rola z sesją zostaje
 * sprawdzana). Klucz: `plik: ścieżka funkcji` (`guestKey`); wartość: dowód
 * bramki z `plik:linia` (np. `src/components/Bell.tsx:42 enabled: !!user`) -
 * bez niego wpis czerwieni `check:ts-sql-contract`. Wpis, który nie trafia
 * w funkcję z faktem gościa w pliku `public`, też (naprawiony albo
 * przeniesiony - zdejmij). Listę wypełnia przegląd wyniku
 * `bun run generate:ts-sql-contract --guest-gaps` (klucze, które jako gość
 * padają na bazie po migracjach).
 */
export const GUEST_LOGIN_ONLY_REVIEWED: Readonly<Record<string, string>> = {};

/** Dowód bramki we wpisie gościa: ścieżka pliku z numerem linii. */
const GUARD_EVIDENCE_RE = /(?:^|[\s(`'"])[\w@.\-/]+\.(?:tsx?|sql):\d+/;

/** Fakty klienta przeglądarki (wiersze gościa) z kluczem i klasą osiągalności pliku. */
function guestFactKeys(
  facts: SeamFacts,
  reach: ReadonlyMap<string, SiteReach>,
): Map<string, string> {
  const o = facts.observed;
  const out = new Map<string, string>();
  for (const x of [...o.rpcs, ...o.tables, ...o.filters, ...o.embeds, ...o.statements]) {
    if (!x.guest || x.role !== "authenticated") continue;
    out.set(guestKey(x.site, x.fn), reach.get(x.site)?.cls ?? "none");
  }
  return out;
}

/**
 * Rozjazd listy gościa: `stale` - wpis bez funkcji z faktem gościa w pliku
 * klasy `public` (naprawiony, przeniesiony, plik zmienił klasę - zdejmij);
 * `invalid` - wpis bez dowodu `plik:linia`.
 */
export function guestLoginOnlyDrift(
  facts: SeamFacts,
  reach: ReadonlyMap<string, SiteReach>,
  reviewed: Readonly<Record<string, string>> = GUEST_LOGIN_ONLY_REVIEWED,
): { stale: string[]; invalid: string[] } {
  const keys = guestFactKeys(facts, reach);
  const stale: string[] = [];
  const invalid: string[] = [];
  for (const [key, reason] of Object.entries(reviewed)) {
    const cls = keys.get(key);
    if (cls !== "public") {
      stale.push(
        `${key} (${cls === undefined ? "brak faktu klienta przeglądarki w tej funkcji" : `klasa pliku ${cls}, wpis tylko dla public`})`,
      );
    }
    if (!GUARD_EVIDENCE_RE.test(reason))
      invalid.push(`${key} (powód bez dowodu bramki plik:linia)`);
  }
  return { stale: stale.sort(), invalid: invalid.sort() };
}

/**
 * Funkcje wyłączone z sond RPC (nazwa -> powód). Sonda woła funkcję SECURITY
 * INVOKER z NULL-ami i drugi raz z argumentami syntetycznymi (stałe wartości
 * typów) jako rola klienta w podtransakcji wycofywanej
 * wartownikiem - zapisy, `pg_net` (kolejka w tabeli) i powiadomienia cofają
 * się z nią, ale synchroniczne wywołanie zewnętrzne (rozszerzenie `http`,
 * `dblink`) już nie. Przegląd listopad 2026: migracje nie instalują `http`
 * ani `dblink` (`dblink` występuje wyłącznie w komentarzach o harnessie
 * wyścigów), a `net.http_post` z `pg_net` tylko kolejkuje - lista jest pusta.
 * Funkcja z takim wywołaniem trafia tu z powodem, zanim pojawi się w kodzie.
 */
export const RPC_PROBE_EXCLUDED: Readonly<Record<string, string>> = {};

/** Wpis przeglądu wyzwalacza SECURITY INVOKER: md5 `prosrc` z przeglądu i powód. */
export interface InvokerTriggerReviewed {
  readonly md5: string;
  readonly reason: string;
}

/**
 * Funkcje wyzwalaczy SECURITY INVOKER odpalanych zapisem klienta (`schemat.nazwa`
 * -> md5 ciała i powód). Sondy zapisu to `EXPLAIN` - planowanie nie wykonuje
 * wyzwalaczy, więc funkcja wyzwalacza czytająca (albo zapisująca) kolumnę bez
 * grantu roli klienta psuje KAŻDY taki zapis 42501, a sondy tego nie widzą.
 * Asercja 20 wymaga dla każdego wyzwalacza (wierszowego i instrukcji, BEFORE,
 * AFTER), który odpala INSERT/UPDATE/upsert/DELETE faktu zapisu `anon` albo
 * `authenticated` (UPDATE OF kolumny - tylko gdy ładunek je zawiera): funkcji
 * SECURITY DEFINER albo wpisu tutaj z md5 bieżącego ciała - zmiana ciała to
 * ponowny przegląd, a wpis bez takiego wyzwalacza jest nieaktualny.
 *
 * Wykonanie prawdziwego INSERT w podtransakcji (BEFORE ROW przed RLS
 * i ograniczeniami) sprawdzone na PG16 z seedem: 127 zapisów klienta bez
 * nowej odmowy uprawnień i bez przesunięcia sekwencji, ale odpala tylko
 * wyzwalacze INSERT (13 z 59), a UPDATE/DELETE potrzebują istniejącego wiersza
 * (dane ma 67 z 381 tabel) - stąd przegląd, nie sonda.
 */
// Przegląd listopad 2026 (10a7ea59, PG16 po wszystkich migracjach): ciało
// każdej funkcji przeczytane; funkcje wołane z ciała - EXECUTE sprawdzony
// `has_function_privilege` dla anon i authenticated (EXECUTE samej funkcji
// wyzwalacza Postgres sprawdza tylko przy CREATE TRIGGER).
const TOUCH_ONLY = "tylko `NEW.updated_at := now()` - bez odczytu relacji i bez innych funkcji";
const NEW_OLD_ONLY = "pola NEW/OLD i `now()` - bez odczytu relacji i bez innych funkcji";

export const INVOKER_TRIGGERS_REVIEWED: Readonly<Record<string, InvokerTriggerReviewed>> = {
  "public._tg_touch_updated_at": { md5: "d649a110c6bbd423f02e7d4c848573a9", reason: TOUCH_ONLY },
  "public.check_page_parent_no_cycle": {
    md5: "eb0e2ea48f838a1974f2fecd0faf6e36",
    reason:
      "czyta wyłącznie `pages.parent_id` i `pages.id` (pętla po przodkach) - SELECT obu kolumn mają anon i authenticated; RLS ogranicza widoczne strony, a niewidoczny przodek kończy pętlę bez błędu",
  },
  "public.crm_leads_sync_phone_norm": {
    md5: "a22fede17786433ff68e03026b4a8e9a",
    reason:
      "woła `crm_normalize_phone(text)` (SQL IMMUTABLE, operacje na tekście, bez relacji; EXECUTE anon i authenticated)",
  },
  "public.nes_messages_search_vector": {
    md5: "e2708e4027a89a075b630833e5690175",
    reason:
      "`to_tsvector('public.nes_polish', ...)` na polach NEW - konfiguracja wyszukiwania nie ma uprawnień, bez odczytu relacji",
  },
  "public.pages_search_vector_refresh": {
    md5: "2d9b5c9548124bca2ba4526e6c28577e",
    reason:
      "woła `nes_pages_search_vector(...)` (SQL STABLE: `to_tsvector`, `unaccent`, `nes_jsonb_text` - bez relacji; EXECUTE wszystkich dla anon i authenticated)",
  },
  "public.pages_validate_takeaways": {
    md5: "904c446040b8462df52c3558f1cb3af0",
    reason: "walidacja tablic `takeaways_*` z NEW (RAISE przy przekroczeniu) - bez odczytu relacji",
  },
  "public.post_sidebar_layouts_enforce_default": {
    md5: "cddf64708a5640370d283a699b9f224c",
    reason:
      "przy `NEW.is_default` UPDATE `post_sidebar_layouts.is_default` po `tenant_id`, `id`, `is_default` - authenticated ma UPDATE(is_default) i SELECT tych kolumn, a zapis klienta (SidebarBuilderPane) działa na tej samej tabeli pod tymi samymi politykami RLS",
  },
  "public.posts_search_vector_refresh": {
    md5: "42be6881709f0f4ff943894498d4e4c4",
    reason:
      "woła `nes_posts_search_vector(...)` (SQL STABLE: `to_tsvector`, `unaccent`, `nes_jsonb_text` - bez relacji; EXECUTE wszystkich dla anon i authenticated)",
  },
  "public.posts_validate_takeaways": {
    md5: "904c446040b8462df52c3558f1cb3af0",
    reason: "walidacja tablic `takeaways_*` z NEW (RAISE przy przekroczeniu) - bez odczytu relacji",
  },
  "public.profiles_discoverable_decided_at_pin": {
    md5: "97aedf893d97674eeab283fb4e58a225",
    reason: "`NEW.discoverable_decided_at := OLD.discoverable_decided_at` - bez odczytu relacji",
  },
  "public.profiles_discoverable_decision_stamp": {
    md5: "39f0fbd4335def0922ca7e15ab190d57",
    reason:
      "pola NEW, `now()` i `auth.uid()` (SQL na `current_setting`; EXECUTE anon i authenticated) - bez odczytu relacji",
  },
  "public.profiles_mirror_bio": {
    md5: "b825457aae90e5e772d2efac9d6ee9c0",
    reason: "`btrim`/`NULLIF` na polach NEW - bez odczytu relacji",
  },
  "public.profiles_pin_tenant": {
    md5: "8b5c406f3fda297cf67911db8d3b824d",
    reason:
      "przy zmianie `tenant_id` woła `is_service_role_caller()` i `has_role(...)` (obie SECURITY DEFINER; authenticated ma EXECUTE obu). anon nie ma EXECUTE `is_service_role_caller`, ale nie ma też UPDATE na profiles - zapis profilu jako anon pada na uprawnieniu tabeli przed wyzwalaczem (asercje 17/19)",
  },
  "public.saved_searches_alert_defaults": {
    md5: "99d894bfb66c2dd054f4b7d0172a2110",
    reason: NEW_OLD_ONLY,
  },
  "public.set_updated_at": { md5: "301a884953d37769916294bb60562e05", reason: TOUCH_ONLY },
  "public.tg_crm_scoring_settings_touch": {
    md5: "db79ec82248998564a64ee07f421b3da",
    reason: "`now()` i `auth.uid()` (EXECUTE anon i authenticated) - bez odczytu relacji",
  },
  "public.tg_crm_tasks_normalize": {
    md5: "fac8dfea8acb21625cd1ed066b8d3725",
    reason: NEW_OLD_ONLY,
  },
  "public.tg_events_stamp_lifecycle": {
    md5: "f18b7e727b25bdab3e26dcb7aa2fc6d0",
    reason: NEW_OLD_ONLY,
  },
  "public.tg_events_stamp_lifecycle_insert": {
    md5: "8aa7542eb68118827ea75c75669a3d2c",
    reason: NEW_OLD_ONLY,
  },
  "public.tg_notification_preferences_touch": {
    md5: "5b733ab523bad442e4b10f836de9e4ba",
    reason: TOUCH_ONLY,
  },
  "public.tg_payment_orders_stamp_retention": {
    md5: "c2e88776bfa1746564b0620032a493f5",
    reason:
      "woła `accounting_retention_until(timestamptz)` (SQL IMMUTABLE, `make_date`/`EXTRACT` - bez relacji; EXECUTE anon i authenticated)",
  },
};

/**
 * Funkcje RPC, których sondy (argumenty NULL i syntetyczne) kończą się bez
 * błędu i bez odczytu ŻADNEJ relacji (liczniki `pg_stat_get_xact_*` sesji) -
 * nazwa -> powód. Taka sonda nie sprawdziła ciała (strażnik argumentu,
 * wczesny RETURN), więc bez wpisu to naruszenie asercji 16/19; wpis tylko dla
 * funkcji, która z natury nie czyta relacji. Na 10a7ea59 żadna sonda nie jest
 * pusta - lista pusta; wpis funkcji, której sonda pusta nie jest, czerwieni
 * asercję 16 (nieaktualny).
 */
export const RPC_PROBE_VACUOUS_REVIEWED: Readonly<Record<string, string>> = {};

/** Wejście bramki z miary (`renderContractTest`, `renderGuestGaps`). */
export interface ContractEnforcement {
  /**
   * Osiągalność pliku wywołania dla gościa (`guestReach`). Plik spoza mapy -
   * klasa `none`: wiersze gościa sprawdzane (niepewne nie jest zwolnieniem).
   */
  readonly reach: ReadonlyMap<string, SiteReach>;
  readonly guestLoginOnly?: Readonly<Record<string, string>>;
  readonly rpcProbeExcluded?: Readonly<Record<string, string>>;
  /** Funkcje z pustą sondą RPC przejrzane; domyślnie `RPC_PROBE_VACUOUS_REVIEWED`. */
  readonly rpcProbeVacuous?: Readonly<Record<string, string>>;
  /** Wyzwalacze SECURITY INVOKER przejrzane; domyślnie `INVOKER_TRIGGERS_REVIEWED`. */
  readonly invokerTriggers?: Readonly<Record<string, InvokerTriggerReviewed>>;
}

/** Wejście sprawdzeń miary w `seamCoverageProblems` (bez bazy). */
export interface ObservedCoverage {
  readonly reach: ReadonlyMap<string, SiteReach>;
  readonly unknownRole?: Readonly<Record<string, readonly [number, string]>>;
  readonly guestLoginOnly?: Readonly<Record<string, string>>;
}

/** Problemy zasięgu miary w bramce - lista ról nieustalonych, lista gościa, zapadki filtrów. */
function observedCoverageProblems(facts: SeamFacts, input: ObservedCoverage): string[] {
  const problems: string[] = [];
  const o = facts.observed;
  // Bez miary (`extractSeamFacts` bez `observe`) każda lista byłaby
  // „nieaktualna", a pgTAP - bez asercji miary: to błąd wywołania, nie kodu.
  if (o.rpcs.length !== facts.rpcs.length || o.tables.length < facts.tables.length) {
    problems.push(
      "miara nie uruchomiona (`extractSeamFacts(..., { observe: true })`) - role zmierzone, filtry, osadzenia i sondy nie trafią do pgTAP",
    );
    return problems;
  }
  const unknown = unknownRoleDrift(facts, input.unknownRole);
  if (unknown.fresh.length > 0) {
    problems.push(
      `${unknown.fresh.length} kluczy z rolą klienta nieustaloną (bez sprawdzenia uprawnień) spoza listy UNKNOWN_ROLE_REVIEWED - klient wprost albo parametr z jedną rolą; dopiero gdy się nie da - wpis z powodem:\n` +
        unknown.fresh.map((x) => `        ${x}`).join("\n"),
    );
  }
  if (unknown.stale.length > 0) {
    problems.push(
      `${unknown.stale.length} wpisów UNKNOWN_ROLE_REVIEWED nieaktualnych (rola już ustalona albo mniej faktów - zdejmij wpis lub zmniejsz licznik):\n` +
        unknown.stale.map((x) => `        ${x}`).join("\n"),
    );
  }
  const guest = guestLoginOnlyDrift(facts, input.reach, input.guestLoginOnly);
  if (guest.stale.length > 0 || guest.invalid.length > 0) {
    problems.push(
      `${guest.stale.length + guest.invalid.length} wpisów GUEST_LOGIN_ONLY_REVIEWED do poprawy (wpis tylko dla funkcji z faktem gościa w pliku klasy public, z dowodem bramki plik:linia):\n` +
        [...guest.stale, ...guest.invalid].map((x) => `        ${x}`).join("\n"),
    );
  }
  if (o.unresolvedFilters.length > MAX_UNRESOLVED_FILTER_SITES) {
    problems.push(
      `${o.unresolvedFilters.length} miejsc filtrów nieczytelnych - kolumn kontrakt nie sprawdza (zapadka MAX_UNRESOLVED_FILTER_SITES: ${MAX_UNRESOLVED_FILTER_SITES}):\n` +
        o.unresolvedFilters.map((x) => `        ${x}`).join("\n"),
    );
  }
  if (o.filtersOutsideChains.length > MAX_FILTERS_OUTSIDE_CHAINS) {
    problems.push(
      `${o.filtersOutsideChains.length} wywołań filtra poza rozpoznanym budowniczym (zapadka MAX_FILTERS_OUTSIDE_CHAINS: ${MAX_FILTERS_OUTSIDE_CHAINS}):\n` +
        o.filtersOutsideChains.map((x) => `        ${x}`).join("\n"),
    );
  }
  return problems;
}

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
  /**
   * Wejście asercji miary (10-20). Domyślnie bez mapy osiągalności: każdy
   * plik to `none`, więc wiersze gościa są sprawdzane wszędzie.
   */
  enforcement: ContractEnforcement = { reach: new Map() },
): string {
  const gate = observedGate(facts, enforcement);
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
-- Kazda asercja zwraca LISTE naruszen z plikami TS, ktore je wnosza
-- (asercje 10-20 - z plikiem i funkcja wywolania).
${gate.header}-- ============================================================================
BEGIN;
SELECT plan(${9 + OBSERVED_ASSERTIONS});

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

${gate.setup}${OBSERVED_ASSERTIONS_SQL}
SELECT * FROM finish();
ROLLBACK;
`;
}

// ── Render bramki z miary (asercje 10-20 i raport `--guest-gaps`) ───────────

/** Asercje pgTAP bramki z miary - plan pliku to 9 + tyle. */
const OBSERVED_ASSERTIONS = 11;

/**
 * Klasyfikacja wyniku sondy bramki: odmowa uprawnień, brak obiektu i limit
 * czasu (sonda bez werdyktu) - naruszenie; inne błędy (P0001, P0004 `ASSERT`
 * funkcji dla syntetycznych argumentów, 23502 po wyzwalaczach BEFORE) - nie.
 */
const GATE_PROBE_OUTCOME = `      v_outcome := CASE WHEN v_state = '00000' THEN 'ok'
                        WHEN v_state = '42501' AND v_msg LIKE 'permission denied for %' THEN 'brak uprawnienia'
                        WHEN v_state IN ('42703', '42P01', '42883') THEN 'brak obiektu'
                        WHEN v_state = '42501' THEN 'odmowa autoryzacji (RAISE 42501)'
                        WHEN v_state IN ('57014', '55P03') THEN 'przekroczony czas'
                        ELSE 'inny blad ' || v_state END;
`;

interface ObservedGate {
  /** Nagłówek (komentarz SQL) z liczbami wierszy i zwolnień gościa. */
  readonly header: string;
  /** Tabele faktów, relacje osadzeń, sondy i widoki naruszeń `ts_v_*`. */
  readonly setup: string;
}

/**
 * Wiersze faktów miary w bramce. Rola zmierzona (`role`), rola bramki
 * (`enforced`) i flaga wiersza gościa (`guest`): fakt klienta przeglądarki
 * w pliku osiągalnym dla gościa ma DRUGI wiersz z rolą `anon`. Fakty
 * wstrzymane w przeglądzie - bez wierszy uprawnień i bez sond.
 */
function observedGate(facts: SeamFacts, enforcement: ContractEnforcement): ObservedGate {
  const o = facts.observed;
  const reviewed = enforcement.guestLoginOnly ?? GUEST_LOGIN_ONLY_REVIEWED;
  const excluded = Object.keys(enforcement.rpcProbeExcluded ?? RPC_PROBE_EXCLUDED).sort();
  const triggerRows = Object.entries(enforcement.invokerTriggers ?? INVOKER_TRIGGERS_REVIEWED)
    .map(([fn, entry]) => [sqlString(fn), sqlString(entry.md5)].join(", "))
    .sort();
  const vacuousReviewed = Object.keys(
    enforcement.rpcProbeVacuous ?? RPC_PROBE_VACUOUS_REVIEWED,
  ).sort();
  const clsOf = (site: string): string => enforcement.reach.get(site)?.cls ?? "none";
  const guestOn = (x: {
    readonly guest: boolean;
    readonly role: MeasuredRole;
    readonly site: string;
    readonly fn: string;
  }): boolean =>
    x.guest &&
    x.role === "authenticated" &&
    !GUEST_EXEMPT_CLASSES.has(clsOf(x.site)) &&
    reviewed[guestKey(x.site, x.fn)] === undefined;
  /** Wiersz faktu i - gdy gość sprawdzany - jego wiersz `anon` (`render(fakt, gość)`). */
  const rows = <
    T extends {
      readonly guest: boolean;
      readonly role: MeasuredRole;
      readonly site: string;
      readonly fn: string;
    },
  >(
    xs: readonly T[],
    own: (x: T) => boolean,
    render: (x: T, role: MeasuredRole, guest: boolean) => string,
  ): string[] =>
    xs.flatMap((x) => [
      ...(own(x) ? [render(x, x.role, false)] : []),
      ...(guestOn(x) ? [render(x, "anon", true)] : []),
    ]);
  const sorted = (xs: readonly string[]): string[] => [...new Set(xs)].sort();
  const guestVia = (via: string, guest: boolean): string =>
    guest ? `${GUEST_VIA} <- ${via}`.slice(0, MAX_VIA) : via;

  const rpcRows = sorted(
    rows(
      o.rpcs,
      (r) => CLIENT_ROLES.has(r.role),
      (r, role, guest) =>
        [
          sqlString(r.name),
          sqlTextArray(r.keys),
          sqlString(role),
          sqlString(r.enforcedRole),
          sqlString(guestVia(r.via, guest)),
          guest ? "true" : "false",
          sqlString(r.site),
          sqlString(r.fn),
        ].join(", "),
    ),
  );
  // Fakty tabel: rola zmierzona tylko tam, gdzie różni się od roli bramki
  // (tę samą rolę sprawdza już asercja 5).
  const tableRows = sorted(
    rows(
      o.tables.filter((t) => !t.withheld),
      (t) => CLIENT_ROLES.has(t.role) && t.role !== t.enforcedRole,
      (t, role, guest) =>
        [
          sqlString(t.table),
          sqlString(t.op),
          sqlString(role),
          sqlString(t.enforcedRole),
          sqlTextArray(t.columns),
          t.star ? "true" : "false",
          sqlString(guestVia(t.via, guest)),
          guest ? "true" : "false",
          sqlString(t.file),
          sqlString(t.site),
          sqlString(t.fn),
        ].join(", "),
    ),
  );
  // Filtry i osadzenia: także z rolą nieustaloną (istnienie kolumn).
  const filterRows = sorted(
    rows(
      o.filters,
      () => true,
      (f, role, guest) =>
        [
          sqlString(f.table),
          f.column === PRIMARY_KEY_COLUMNS ? "NULL" : sqlString(f.column),
          f.embed === null ? "NULL" : sqlString(f.embed),
          sqlString(f.method),
          sqlString(f.op),
          sqlString(role),
          sqlString(f.gateRole),
          guest ? "true" : "false",
          sqlString(f.file),
          sqlString(f.site),
          sqlString(f.fn),
        ].join(", "),
    ),
  );
  // Osadzenia w kolejności `id` (rodzic przed dzieckiem; ekstrakcja jest
  // deterministyczna), wiersz gościa zaraz za swoim.
  const embedRows = [
    ...new Set(
      rows(
        o.embeds,
        () => true,
        (e, role, guest) =>
          [
            String(e.id),
            e.parentId === null ? "NULL" : String(e.parentId),
            sqlString(e.table),
            sqlString(e.path),
            sqlString(e.rel),
            e.hint === null ? "NULL" : sqlString(e.hint),
            sqlTextArray(e.columns),
            e.star ? "true" : "false",
            sqlString(role),
            sqlString(e.gateRole),
            guest ? "true" : "false",
            sqlString(e.file),
            sqlString(e.site),
            sqlString(e.fn),
          ].join(", "),
      ),
    ),
  ];
  const statementRows = sorted(
    rows(
      o.statements.filter((s) => !s.withheld),
      (s) => CLIENT_ROLES.has(s.role),
      (s, role, guest) =>
        [
          sqlString(s.table),
          sqlString(s.op),
          sqlString(role),
          sqlString(s.enforcedRole),
          sqlTextArray(s.columns),
          s.star ? "true" : "false",
          sqlTextArray(s.payload),
          sqlTextArray(s.where),
          sqlTextArray(s.conflict),
          guest ? "true" : "false",
          sqlString(s.site),
          sqlString(s.fn),
        ].join(", "),
    ),
  );

  // Pary (plik, funkcja) z faktami klienta przeglądarki - do nagłówka.
  const guestKeys = new Map<string, string>();
  for (const x of [...o.rpcs, ...o.tables, ...o.filters, ...o.embeds, ...o.statements]) {
    if (!x.guest || x.role !== "authenticated") continue;
    const key = guestKey(x.site, x.fn);
    const cls = clsOf(x.site);
    guestKeys.set(
      key,
      GUEST_EXEMPT_CLASSES.has(cls)
        ? cls
        : reviewed[key] !== undefined
          ? "przejrzane"
          : `sprawdzane ${cls}`,
    );
  }
  const byClass = (label: string): number =>
    [...guestKeys.values()].filter((v) => v === label).length;
  const unknownFacts = [...o.rpcs, ...o.tables].filter((x) => x.role === "unknown").length;
  const rel = (name: string): string => `to_regclass('public.' || quote_ident(${name}))`;
  const roles = "('anon', 'authenticated', 'service_role')";

  const header = `--
-- Asercje 10-20 - FAKTY MIARY (SeamFacts.observed): rola klienta ustalona
-- szerzej niz reguly bramki (nigdy zgadywana), kolumny filtrow, sortowania
-- i celu upsertu, zasoby osadzone list select, sondy wykonania (kazde zapytanie
-- jako rola w podtransakcji, wycofane) i gosc (anon) klienta przegladarki.
-- Rola nieustalona takze dla miary: ${unknownFacts} faktow RPC i tabel - tylko istnienie,
-- kazdy z lista UNKNOWN_ROLE_REVIEWED (check:ts-sql-contract).
-- Gosc (anon): ${guestKeys.size} par (plik wywolania, funkcja) z faktami klienta przegladarki.
--   Sprawdzane jako anon (plik osiagalny dla goscia): public ${byClass("sprawdzane public")}, none ${byClass("sprawdzane none")}.
--   Wylaczone STRUKTURALNIE (plik osiagalny wylacznie z panelu /admin albo spod
--   bramki sesji - guestReach): admin ${byClass("admin")}, session-gate ${byClass("session-gate")}.
--   Wylaczone wpisem GUEST_LOGIN_ONLY_REVIEWED (public tylko z sesja, z dowodem): ${byClass("przejrzane")}.
-- Sondy RPC: funkcje SECURITY INVOKER wolane przez anon/authenticated; wylaczone
-- (RPC_PROBE_EXCLUDED, wywolanie zewnetrzne nie cofa sie z transakcja): ${excluded.length === 0 ? "brak" : excluded.join(", ")}.
-- Sonda pada na 42501 "permission denied for ...", brak obiektu (42703, 42P01,
-- 42883) i brak werdyktu (limit czasu 57014 albo blokady 55P03, sonda
-- nieuruchomiona); inny blad (np. P0001 albo ASSERT P0004 funkcji) przechodzi.
-- Odczyt to SELECT ... LIMIT 1 (wiersz z danych liczy kolumny widoku i funkcje
-- wiersza); RPC dwie sondy - argumenty NULL i syntetyczne (cialo za straznikiem
-- NULL); obie bez bledu i bez odczytu zadnej relacji - sonda pusta, naruszenie
-- (przejrzane RPC_PROBE_VACUOUS_REVIEWED: ${vacuousReviewed.length === 0 ? "brak" : vacuousReviewed.join(", ")}).
-- Wyzwalacze SECURITY INVOKER odpalane zapisem klienta - sondy zapisu (EXPLAIN)
-- ich nie wykonuja: asercja 20, przejrzane INVOKER_TRIGGERS_REVIEWED: ${triggerRows.length}.
`;

  const setup = `-- ── Fakty miary (asercje 10-20) ─────────────────────────────────────────────
CREATE TEMP TABLE ts_obs_rpc (fn text, keys text[], role text, enforced text, via text, guest boolean, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE ts_obs_table (rel text, op text, role text, enforced text, cols text[], star boolean, via text, guest boolean, file text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE ts_obs_filter (rel text, col text, embed text, method text, op text, role text, enforced text, guest boolean, file text, site text, func text, via text) ON COMMIT DROP;
CREATE TEMP TABLE ts_obs_stmt (rel text, op text, role text, enforced text, cols text[], star boolean, payload text[], where_cols text[], conflict text[], guest boolean, site text, func text, via text) ON COMMIT DROP;
CREATE TEMP TABLE ts_obs_embed (id int, parent_id int, tbl text, path text, rel text, hint text, cols text[], star boolean, role text, enforced text, guest boolean, file text, site text, func text, via text) ON COMMIT DROP;

${valuesBlock("ts_obs_rpc", "fn, keys, role, enforced, via, guest, site, func", rpcRows)}
${valuesBlock("ts_obs_table", "rel, op, role, enforced, cols, star, via, guest, file, site, func", tableRows)}
${valuesBlock("ts_obs_filter", "rel, col, embed, method, op, role, enforced, guest, file, site, func", filterRows)}
${valuesBlock("ts_obs_stmt", "rel, op, role, enforced, cols, star, payload, where_cols, conflict, guest, site, func", statementRows)}
${valuesBlock("ts_obs_embed", "id, parent_id, tbl, path, rel, hint, cols, star, role, enforced, guest, file, site, func", embedRows)}
-- Relacje osadzen (tabela ts_obs_embed_rel: id, rodzic, relacja, klucz obcy).
${EMBED_FUNCTIONS_SQL}
${embedRelSql("ts_obs_embed", "ts_obs_embed_rel")}
-- Kolumny filtrow: cel konfliktu bez onConflict (col NULL) = klucz glowny.
CREATE TEMP VIEW ts_obs_filter_cols AS
SELECT f.rel, coalesce(f.col, pk.col) AS col, f.embed, f.method, f.op, f.role, f.enforced, f.via,
       f.guest, f.file, f.site, f.func
  FROM ts_obs_filter f
  LEFT JOIN LATERAL (
    SELECT a.attname::text AS col
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])
     WHERE i.indrelid = ${rel("f.rel")} AND i.indisprimary
  ) pk ON f.col IS NULL;

${probeSql({
  probe: "ts_probe",
  stmt: "ts_obs_stmt",
  filterCols: "ts_obs_filter_cols",
  rpc: "ts_obs_rpc",
  embed: "ts_obs_embed",
  embedRel: "ts_obs_embed_rel",
  guest: true,
  rpcExcluded: excluded,
  outcome: GATE_PROBE_OUTCOME,
})}
-- ── Naruszenia (kind, guest, site, func, msg): asercje 10-20 i --guest-gaps ──
-- Fakty RPC i tabel z rola zmierzona INNA niz rola bramki (te sama sprawdzaja
-- asercje 2 i 5) oraz wiersze goscia.
CREATE TEMP VIEW ts_v_fact AS
SELECT 'rpc' AS kind, r.guest, r.site, r.func,
       format('%s: %s: %s(%s) dla %s: brak EXECUTE (rola: %s)', r.site, r.func, r.fn,
              coalesce(array_to_string(r.keys, ','), '?'), r.role, r.via) AS msg
  FROM ts_obs_rpc r
 WHERE (r.guest OR r.role IS DISTINCT FROM r.enforced)
   AND ((r.keys IS NOT NULL AND pg_temp.ts_rpc_match(r.fn, r.keys) IS NOT NULL
         AND NOT has_function_privilege(r.role, pg_temp.ts_rpc_match(r.fn, r.keys), 'EXECUTE'))
        OR (r.keys IS NULL AND EXISTS (
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = r.fn)
            AND NOT EXISTS (
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = r.fn
                 AND has_function_privilege(r.role, p.oid, 'EXECUTE'))))
UNION ALL
SELECT 'table', t.guest, t.site, t.func,
       format('%s: %s: %s.%s %s dla %s: brak %s (rola: %s%s)', t.site, t.func, t.rel, c.col, t.op,
              t.role, priv, t.via, CASE WHEN t.file <> t.site THEN '; kolumny z ' || t.file ELSE '' END)
  FROM ts_obs_table t
  CROSS JOIN LATERAL (
    SELECT a.attname::text AS col FROM pg_attribute a
     WHERE a.attrelid = ${rel("t.rel")} AND a.attnum > 0 AND NOT a.attisdropped
       AND (t.star OR a.attname = ANY (t.cols))
  ) c
  CROSS JOIN LATERAL unnest(CASE t.op
      WHEN 'select' THEN ARRAY['SELECT']
      WHEN 'insert' THEN ARRAY['INSERT']
      WHEN 'update' THEN ARRAY['UPDATE']
      WHEN 'upsert' THEN ARRAY['INSERT', 'UPDATE']
      WHEN 'upsert_ignore' THEN ARRAY['INSERT']
      ELSE ARRAY[]::text[] END) AS priv
 WHERE (t.guest OR t.role IS DISTINCT FROM t.enforced)
   AND NOT has_column_privilege(t.role, ${rel("t.rel")}, c.col, priv)
UNION ALL
SELECT 'table', t.guest, t.site, t.func,
       format('%s: %s: %s delete dla %s: brak DELETE (rola: %s)', t.site, t.func, t.rel, t.role, t.via)
  FROM ts_obs_table t
 WHERE t.op = 'delete' AND (t.guest OR t.role IS DISTINCT FROM t.enforced)
   AND ${rel("t.rel")} IS NOT NULL
   AND NOT has_table_privilege(t.role, ${rel("t.rel")}, 'DELETE');

-- Kolumny filtrow: istnienie (relacja, kolumna, klucz glowny celu bez onConflict).
-- Relacja filtra osadzenia nieczytelna jako tabela (osadzenie po nazwie klucza
-- obcego) - pomijana tu; relacje osadzen sprawdza asercja 14.
CREATE TEMP VIEW ts_v_filter_missing AS
SELECT DISTINCT f.site, f.func,
       format('%s: %s: %s.%s (%s%s, %s%s): %s', f.site, f.func, f.rel, coalesce(f.col, '(klucz glowny)'),
              f.method, coalesce(', osadzenie ' || f.embed, ''), f.op,
              CASE WHEN f.file <> f.site THEN ', literal w ' || f.file ELSE '' END,
              CASE WHEN ${rel("f.rel")} IS NULL THEN 'relacja nie istnieje'
                   WHEN f.col IS NULL THEN 'brak klucza glownego'
                   ELSE 'kolumna nie istnieje' END) AS msg
  FROM ts_obs_filter_cols f
 WHERE (${rel("f.rel")} IS NULL AND f.embed IS NULL)
    OR (${rel("f.rel")} IS NOT NULL
        AND (f.col IS NULL OR NOT EXISTS (
              SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = ${rel("f.rel")} AND a.attname = f.col
                 AND a.attnum > 0 AND NOT a.attisdropped)));

-- Kolumny filtrow: SELECT roli (Postgres wymaga go dla WHERE/ORDER BY takze
-- w UPDATE i DELETE). Kolumna przez zlaczenie z pg_attribute, uprawnienie po
-- numerze kolumny: \`AND EXISTS (...)\` nie gwarantuje kolejnosci, a
-- has_column_privilege po NAZWIE kolumny, ktorej nie ma, przerywa caly plik
-- (42703) - brak kolumny zglasza asercja 12.
CREATE TEMP VIEW ts_v_filter_denied AS
SELECT DISTINCT f.guest, f.site, f.func,
       format('%s: %s: %s.%s dla %s: brak SELECT (%s%s, %s%s)', f.site, f.func, f.rel, f.col, f.role,
              f.method, coalesce(', osadzenie ' || f.embed, ''), f.op,
              CASE WHEN f.file <> f.site THEN ', literal w ' || f.file ELSE '' END) AS msg
  FROM ts_obs_filter_cols f
  JOIN pg_attribute a ON a.attrelid = ${rel("f.rel")} AND a.attname = f.col
                     AND a.attnum > 0 AND NOT a.attisdropped
 WHERE f.role IN ${roles}
   AND NOT has_column_privilege(f.role, a.attrelid, a.attnum, 'SELECT');

-- Osadzenia: relacja (tabela, widok, klucz obcy albo jego kolumna) i kolumny
-- istnieja. Relacja nadrzedna bez kluczy obcych w katalogu (widok) -
-- PostgREST rozwiazuje ja z zaleznosci widoku, wiec brak relacji tylko pod tabela.
CREATE TEMP VIEW ts_v_embed_missing AS
SELECT DISTINCT m.site, m.func,
       format('%s: %s: osadzenie %s (%s) w %s: relacja osadzenia nie istnieje (ani relacja public, ani klucz obcy)',
              m.site, m.func, m.path, m.rel, m.tbl) AS msg
  FROM ts_obs_embed m
  JOIN ts_obs_embed_rel x ON x.id = m.id
  JOIN pg_class pc ON pc.oid = x.parent
 WHERE x.target IS NULL AND pc.relkind IN ('r', 'p')
UNION
SELECT DISTINCT m.site, m.func,
       format('%s: %s: %s.%s (osadzenie %s w %s%s): kolumna nie istnieje', m.site, m.func, c.relname, col,
              m.path, m.tbl, CASE WHEN m.file <> m.site THEN ', literal w ' || m.file ELSE '' END)
  FROM ts_obs_embed m
  JOIN ts_obs_embed_rel x ON x.id = m.id AND x.target IS NOT NULL
  JOIN pg_class c ON c.oid = x.target
  CROSS JOIN LATERAL unnest(m.cols) AS col
 WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = x.target AND a.attname = col
                      AND a.attnum > 0 AND NOT a.attisdropped);

-- Osadzenia: SELECT roli na kolumnach relacji osadzonej (kolumny zlaczenia
-- sprawdza sonda osadzenia).
CREATE TEMP VIEW ts_v_embed_denied AS
SELECT DISTINCT m.guest, m.site, m.func,
       format('%s: %s: %s.%s dla %s: brak SELECT (osadzenie %s w %s%s)', m.site, m.func, c.relname,
              col.col, m.role, m.path, m.tbl,
              CASE WHEN m.file <> m.site THEN ', literal w ' || m.file ELSE '' END) AS msg
  FROM ts_obs_embed m
  JOIN ts_obs_embed_rel x ON x.id = m.id AND x.target IS NOT NULL
  JOIN pg_class c ON c.oid = x.target
  CROSS JOIN LATERAL (
    SELECT a.attname::text AS col FROM pg_attribute a
     WHERE a.attrelid = x.target AND a.attnum > 0 AND NOT a.attisdropped
       AND (m.star OR a.attname = ANY (m.cols))
  ) col
 WHERE m.role IN ${roles}
   AND NOT has_column_privilege(m.role, x.target, col.col, 'SELECT');

-- Wyzwalacze SECURITY INVOKER odpalane zapisem klienta (anon/authenticated):
-- INSERT - insert/upsert, UPDATE - update/upsert (UPDATE OF kolumny tylko gdy
-- ladunek je zawiera), DELETE - delete. Sondy zapisu (EXPLAIN) ich nie
-- wykonuja, wiec funkcja: SECURITY DEFINER albo wpis INVOKER_TRIGGERS_REVIEWED
-- z md5 biezacego ciala; wpis bez takiego wyzwalacza - nieaktualny.
CREATE TEMP TABLE ts_trigger_reviewed (fn text, md5 text) ON COMMIT DROP;
${valuesBlock("ts_trigger_reviewed", "fn, md5", triggerRows)}
CREATE TEMP VIEW ts_v_trigger AS
WITH t AS (
  SELECT n.nspname || '.' || p.proname AS fn, md5(p.prosrc) AS md5, c.relname::text AS rel,
         tg.tgname::text AS tgname, tg.tgtype::int AS tgtype,
         ARRAY(SELECT a.attname::text FROM unnest(tg.tgattr::int2[]) k(attnum)
                 JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = k.attnum) AS cols
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_proc p ON p.oid = tg.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE c.relnamespace = 'public'::regnamespace AND NOT tg.tgisinternal
     AND tg.tgenabled <> 'D' AND NOT p.prosecdef
), fired AS (
  SELECT t.*, s.op, s.role, s.site, s.func
    FROM t
    JOIN ts_obs_stmt s ON s.rel = t.rel AND s.role IN ('anon', 'authenticated')
   WHERE ((t.tgtype & 4) <> 0 AND s.op IN ('insert', 'upsert', 'upsert_ignore'))
      OR ((t.tgtype & 16) <> 0 AND s.op IN ('update', 'upsert')
          AND (cardinality(t.cols) = 0 OR t.cols && s.payload))
      OR ((t.tgtype & 8) <> 0 AND s.op = 'delete')
)
SELECT DISTINCT format('%s: %s: %s %s jako %s -> wyzwalacz %s (%s %s %s) -> %s() SECURITY INVOKER: %s',
         f.site, f.func, f.rel, f.op, f.role, f.tgname,
         CASE WHEN (f.tgtype & 2) <> 0 THEN 'BEFORE' WHEN (f.tgtype & 64) <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END,
         concat_ws('/', CASE WHEN (f.tgtype & 4) <> 0 THEN 'INSERT' END,
                        CASE WHEN (f.tgtype & 16) <> 0 THEN 'UPDATE' END,
                        CASE WHEN (f.tgtype & 8) <> 0 THEN 'DELETE' END),
         CASE WHEN (f.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END, f.fn,
         CASE WHEN r.fn IS NULL THEN 'brak wpisu INVOKER_TRIGGERS_REVIEWED (md5 ' || f.md5 || ')'
              ELSE format('cialo zmienione od przegladu (md5 %s, wpis %s)', f.md5, r.md5) END) AS msg
  FROM fired f
  LEFT JOIN ts_trigger_reviewed r ON r.fn = f.fn
 WHERE r.md5 IS DISTINCT FROM f.md5
UNION
SELECT format('INVOKER_TRIGGERS_REVIEWED: %s - wpis nieaktualny (zaden wyzwalacz SECURITY INVOKER tej funkcji nie odpala sie zapisem klienta)', r.fn)
  FROM ts_trigger_reviewed r
 WHERE NOT EXISTS (SELECT 1 FROM fired f WHERE f.fn = r.fn);

-- Sondy wykonania: odmowa uprawnien, brak obiektu i sonda bez werdyktu
-- (limit czasu albo blokada, sonda nieuruchomiona w zadnej partii).
CREATE TEMP VIEW ts_v_probe AS
SELECT DISTINCT p.guest, p.site, p.func,
       format('%s: %s: %s %s [%s] jako %s: %s %s', p.site, p.func, p.kind, p.rel, p.cols, p.role,
              coalesce(p.state, '-'), coalesce(p.msg, p.outcome)) AS msg
  FROM ts_probe p
 WHERE p.outcome IN ('brak uprawnienia', 'brak obiektu', 'przekroczony czas', 'nie uruchomiona')
UNION
-- Sonda RPC pusta: wszystkie sondy funkcji tego miejsca i roli (argumenty NULL
-- i syntetyczne) bez bledu i bez odczytu zadnej relacji - cialo niesprawdzone.
SELECT p.guest, p.site, p.func,
       format('%s: %s: probe-rpc %s [%s] jako %s: sonda pusta - argumenty NULL i syntetyczne bez bledu i bez odczytu zadnej relacji (cialo funkcji niesprawdzone; RPC_PROBE_VACUOUS_REVIEWED)',
              p.site, p.func, p.rel, p.cols, p.role)
  FROM ts_probe p
 WHERE p.kind LIKE 'probe-rpc%' AND p.rel <> ALL (${sqlTextArray(vacuousReviewed)})
 GROUP BY p.guest, p.site, p.func, p.rel, p.cols, p.role
HAVING bool_and(p.state = '00000') AND sum(p.touched) = 0
UNION
SELECT false, 'RPC_PROBE_VACUOUS_REVIEWED', r.fn,
       format('RPC_PROBE_VACUOUS_REVIEWED: %s - wpis nieaktualny (zadna sonda tej funkcji nie jest pusta)', r.fn)
  FROM unnest(${sqlTextArray(vacuousReviewed)}) AS r(fn)
 WHERE current_setting('track_counts')::boolean
   AND NOT EXISTS (SELECT 1 FROM ts_probe p
                    WHERE p.kind LIKE 'probe-rpc%' AND p.rel = r.fn
                    GROUP BY p.site, p.func, p.role
                   HAVING bool_and(p.state = '00000') AND sum(p.touched) = 0);
`;
  return { header, setup };
}

const OBSERVED_ASSERTIONS_SQL = `
-- 10. Rola zmierzona: RPC (rola bramki unknown albo inna) - EXECUTE.
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_fact WHERE kind = 'rpc' AND NOT guest ORDER BY 1),
  ARRAY[]::text[],
  'RPC z TS: rola zmierzona klienta (inna niz rola bramki) ma EXECUTE na wybranym przeciazeniu');

-- 11. Rola zmierzona: tabele - uprawnienie do operacji na kazdej kolumnie.
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_fact WHERE kind = 'table' AND NOT guest ORDER BY 1),
  ARRAY[]::text[],
  'Tabele z TS: rola zmierzona klienta (inna niz rola bramki) ma uprawnienie do operacji na kazdej kolumnie');

-- 12. Kolumny filtrow, sortowania i celu upsertu istnieja (42703 / PGRST).
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_filter_missing ORDER BY 1),
  ARRAY[]::text[],
  'Filtry z TS: relacja, kolumna filtra/sortowania/upsertu i klucz glowny celu istnieja');

-- 13. Kolumny filtrow: rola ma SELECT (42501 takze w UPDATE/DELETE).
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_filter_denied WHERE NOT guest ORDER BY 1),
  ARRAY[]::text[],
  'Filtry z TS: rola klienta ma SELECT na kazdej kolumnie filtra, sortowania i celu upsertu');

-- 14. Zasoby osadzone: relacja i kolumny istnieja (PGRST200 / 42703).
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_embed_missing ORDER BY 1),
  ARRAY[]::text[],
  'Osadzenia z TS: relacja osadzona i kazda jej kolumna istnieja');

-- 15. Zasoby osadzone: rola ma SELECT na kolumnach relacji osadzonej.
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_embed_denied WHERE NOT guest ORDER BY 1),
  ARRAY[]::text[],
  'Osadzenia z TS: rola klienta ma SELECT na kolumnach relacji osadzonej');

-- 16. Sondy wykonania (widok security_invoker, funkcja SECURITY INVOKER, RLS).
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_probe WHERE NOT guest ORDER BY 1),
  ARRAY[]::text[],
  'Sondy wykonania: zapytanie, filtr, osadzenie i RPC jako rola klienta bez odmowy uprawnien i bez braku obiektu');

-- 17. Gosc (anon): RPC i tabele klienta przegladarki w pliku osiagalnym dla goscia.
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_fact WHERE guest ORDER BY 1),
  ARRAY[]::text[],
  'Gosc (anon): RPC i tabele klienta przegladarki maja EXECUTE i uprawnienia kolumn');

-- 18. Gosc (anon): kolumny filtrow i osadzen.
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM (
          SELECT msg FROM ts_v_filter_denied WHERE guest
          UNION ALL
          SELECT msg FROM ts_v_embed_denied WHERE guest) g
        ORDER BY 1),
  ARRAY[]::text[],
  'Gosc (anon): SELECT na kolumnach filtrow i osadzen klienta przegladarki');

-- 19. Gosc (anon): sondy wykonania.
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_probe WHERE guest ORDER BY 1),
  ARRAY[]::text[],
  'Gosc (anon): sondy wykonania klienta przegladarki bez odmowy uprawnien i bez braku obiektu');

-- 20. Wyzwalacze SECURITY INVOKER odpalane zapisem klienta (sondy ich nie wykonuja).
SELECT is(
  ARRAY(SELECT DISTINCT msg FROM ts_v_trigger ORDER BY 1),
  ARRAY[]::text[],
  'Wyzwalacze SECURITY INVOKER zapisow klienta: wpis INVOKER_TRIGGERS_REVIEWED z md5 biezacego ciala albo SECURITY DEFINER');
`;

/**
 * Raport `generate:ts-sql-contract --guest-gaps`: zwykły SQL (nie pgTAP) do
 * uruchomienia na bazie JEDNORAZOWEJ po migracjach - te same tabele, sondy
 * i widoki naruszeń co pgTAP bramki, a wynik to pary (plik, funkcja), które
 * jako gość (`anon`) padają, z liczbą naruszeń i pierwszym z nich. Kolumna
 * `key` to gotowy klucz `GUEST_LOGIN_ONLY_REVIEWED` - wpis dostaje go
 * WYŁĄCZNIE miejsce tylko po zalogowaniu, z dowodem bramki `plik:linia`;
 * reszta to defekty do naprawy w kodzie albo w grantach.
 */
export function renderGuestGaps(facts: SeamFacts, enforcement: ContractEnforcement): string {
  const gate = observedGate(facts, enforcement);
  return `-- ============================================================================
-- WYGENEROWANE - \`bun run generate:ts-sql-contract --guest-gaps\`. Zwykly SQL, nie
-- pgTAP: pary (plik wywolania, funkcja), ktorych fakty klienta przegladarki
-- padaja jako gosc (anon) - te same wiersze, sondy i widoki co asercje 17-19
-- pgTAP kontraktu. WYLACZNIE baza jednorazowa po migracjach (sondy RPC
-- wykonuja ciala funkcji; calosc w ROLLBACK).
${gate.header}-- ============================================================================
BEGIN;
${RPC_MATCH_SQL}
${gate.setup}
SELECT site || ': ' || func AS key, site, func, count(*) AS violations, min(msg) AS first_violation
  FROM (
    SELECT site, func, msg FROM ts_v_fact WHERE guest
    UNION ALL
    SELECT site, func, msg FROM ts_v_filter_denied WHERE guest
    UNION ALL
    SELECT site, func, msg FROM ts_v_embed_denied WHERE guest
    UNION ALL
    SELECT site, func, msg FROM ts_v_probe WHERE guest
  ) v
 GROUP BY site, func
 ORDER BY site, func;
ROLLBACK;
`;
}

// ── Render pełnej miary (narzędzie przeglądu) ───────────────────────────────

/**
 * Zapytania miary (`generate:ts-sql-contract --measure`): zwykły SQL, nie
 * pgTAP - narzędzie przeglądu (te same fakty sprawdza pgTAP bramki w asercjach
 * 10-20, tu z drogą ustalenia roli, osiągalnością i podsumowaniem sond).
 * Na bazie po wszystkich
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
 * `SELECT kolumny FROM rel WHERE (filtr IS NULL) OR true LIMIT 1` (kolumny
 * widoku i funkcje wiersza liczone dla jednego wiersza, gdy relacja ma
 * dane), zapis jako `EXPLAIN` tej samej instrukcji (ładunek `DEFAULT`,
 * WHERE, RETURNING, `ON CONFLICT`) - planowanie sprawdza uprawnienia każdej
 * relacji po rozwinięciu widoków i polityk, a nic nie jest zapisywane. RPC
 * funkcji `SECURITY INVOKER` wołane przez `anon`/`authenticated` (z EXECUTE)
 * - wywołanie z NULL-ami i z argumentami syntetycznymi w podtransakcji. Każda
 * sonda kończy się wycofaniem podtransakcji (wyjątek wartownika), a całość -
 * `ROLLBACK`; limit czasu instrukcji obejmuje partię sond (`probeSql`).
 * Naruszenie to wyłącznie 42501 „permission denied for …"; 42501 z własnym
 * komunikatem (autoryzacja funkcji), inne błędy (walidacja wejścia) i limit
 * czasu liczy podsumowanie sond.
 */
/** Opis drogi roli w wierszu gościa (klient przeglądarki bez sesji). */
export const GUEST_VIA = "gość bez sesji: klient przeglądarki z kluczem publicznym";

/**
 * Wiersze miary: fakt z rolą zmierzoną, a fakt klienta przeglądarki
 * (`guest`) - DRUGI raz z rolą `anon` (gość, SSR, handler serwera).
 */
export function withGuestRows<
  T extends { readonly role: MeasuredRole; readonly via: string; readonly guest: boolean },
>(xs: readonly T[]): T[] {
  return xs.flatMap((x) =>
    x.guest && x.role === "authenticated"
      ? [x, { ...x, role: "anon" as const, via: `${GUEST_VIA} <- ${x.via}`.slice(0, MAX_VIA) }]
      : [x],
  );
}

/**
 * Osiągalność pliku wywołania dla gościa (`src/lib/ci/guestReach.ts`):
 * klasa wejścia (`public`, `session-gate`, `admin`, `none`), URL wejścia
 * i najkrótsza ścieżka importów - kolumna `reach` naruszeń miary.
 */
export interface SiteReach {
  readonly cls: string;
  readonly entry: string | null;
  readonly path: readonly string[];
}

export function renderObservedQueries(
  facts: SeamFacts,
  reach: ReadonlyMap<string, SiteReach> = new Map(),
): string {
  const o = facts.observed;
  const rpcRows = withGuestRows(o.rpcs).map((r) =>
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
  const tableRows = withGuestRows(o.tables).map((t) =>
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
  const filterRows = withGuestRows(o.filters).map((f) =>
    [
      sqlString(f.table),
      f.column === PRIMARY_KEY_COLUMNS ? "NULL" : sqlString(f.column),
      f.embed === null ? "NULL" : sqlString(f.embed),
      sqlString(f.method),
      sqlString(f.op),
      sqlString(f.role),
      sqlString(f.gateRole),
      sqlString(f.via),
      sqlString(f.file),
      sqlString(f.site),
      sqlString(f.fn),
    ].join(", "),
  );
  const statementRows = withGuestRows(o.statements).map((t) =>
    [
      sqlString(t.table),
      sqlString(t.op),
      sqlString(t.role),
      sqlString(t.enforcedRole),
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
  const embedRows = withGuestRows(o.embeds).map((e) =>
    [
      String(e.id),
      e.parentId === null ? "NULL" : String(e.parentId),
      sqlString(e.table),
      sqlString(e.path),
      sqlString(e.rel),
      e.hint === null ? "NULL" : sqlString(e.hint),
      sqlTextArray(e.columns),
      e.star ? "true" : "false",
      sqlString(e.role),
      sqlString(e.gateRole),
      sqlString(e.via),
      sqlString(e.file),
      sqlString(e.site),
      sqlString(e.fn),
    ].join(", "),
  );
  const sites = [
    ...new Set(
      [...o.rpcs, ...o.tables, ...o.filters, ...o.embeds, ...o.statements].map((x) => x.site),
    ),
  ].sort();
  const reachRows = sites.flatMap((site) => {
    const r = reach.get(site);
    return r === undefined
      ? []
      : [
          [
            sqlString(site),
            sqlString(r.cls),
            r.entry === null ? "NULL" : sqlString(r.entry),
            sqlString(r.path.join(" > ")),
          ].join(", "),
        ];
  });
  const guests =
    rpcRows.length -
    o.rpcs.length +
    (tableRows.length - o.tables.length) +
    (filterRows.length - o.filters.length) +
    (embedRows.length - o.embeds.length) +
    (statementRows.length - o.statements.length);
  const rel = (name: string): string => `to_regclass('public.' || quote_ident(${name}))`;
  const roles = "('anon', 'authenticated', 'service_role')";
  return `-- ============================================================================
-- WYGENEROWANE - MIARA POZA BRAMKA CI (\`bun run generate:ts-sql-contract --measure\`).
-- Nie jest testem pgTAP i nie trafia do supabase/tests. Zwraca naruszenia:
-- rodzaj | plik wywolania | funkcja | relacja | kolumna | rola zmierzona |
-- rola bramki | problem | droga ustalenia roli. Rola bramki faktu tabeli
-- i RPC to rola w pgTAP; kolumny filtra i osadzenia (bramka ich nie
-- sprawdza) - rola bramki klienta ich lancucha. Klient przegladarki ma
-- dwa wiersze: authenticated (z sesja) i anon (gosc, SSR, handler serwera).
-- RPC: ${o.rpcs.length}, fakty tabel: ${o.tables.length}, kolumny filtrow: ${o.filters.length},
-- osadzenia: ${o.embeds.length}, zapytania do sond wykonania: ${o.statements.length};
-- wiersze goscia (klient przegladarki takze jako anon): ${guests}.
-- Najpierw podsumowanie sond (rodzaj | wynik | liczba), potem naruszenia
-- (kolumna caught_by: privilege-check albo execution-probe; kolumna reach:
-- osiagalnosc pliku wywolania dla goscia - klasa wejscia, URL i najkrotsza
-- sciezka importow; '-' bez miary osiagalnosci).
-- WYLACZNIE baza jednorazowa: sondy RPC wykonuja ciala funkcji (wycofane, ale
-- np. sekwencje i wywolania zewnetrzne nie cofaja sie) - nigdy produkcja.
-- ============================================================================
BEGIN;
SET LOCAL statement_timeout = '30min';
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE obs_rpc (fn text, keys text[], role text, enforced text, via text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_table (rel text, op text, role text, enforced text, cols text[], star boolean, via text, file text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_filter (rel text, col text, embed text, method text, op text, role text, enforced text, via text, file text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_stmt (rel text, op text, role text, enforced text, cols text[], star boolean, payload text[], where_cols text[], conflict text[], via text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_embed (id int, parent_id int, tbl text, path text, rel text, hint text, cols text[], star boolean, role text, enforced text, via text, file text, site text, func text) ON COMMIT DROP;
CREATE TEMP TABLE obs_reach (site text PRIMARY KEY, cls text, entry text, path text) ON COMMIT DROP;

${valuesBlock("obs_rpc", "fn, keys, role, enforced, via, site, func", rpcRows)}
${valuesBlock("obs_table", "rel, op, role, enforced, cols, star, via, file, site, func", tableRows)}
${valuesBlock("obs_filter", "rel, col, embed, method, op, role, enforced, via, file, site, func", filterRows)}
${valuesBlock("obs_stmt", "rel, op, role, enforced, cols, star, payload, where_cols, conflict, via, site, func", statementRows)}
${valuesBlock("obs_embed", "id, parent_id, tbl, path, rel, hint, cols, star, role, enforced, via, file, site, func", embedRows)}
${valuesBlock("obs_reach", "site, cls, entry, path", reachRows)}
${RPC_MATCH_SQL}
${EMBED_SQL}
-- Kolumny filtrow: cel konfliktu bez onConflict (col NULL) = klucz glowny.
CREATE TEMP VIEW obs_filter_cols AS
SELECT f.rel, coalesce(f.col, pk.col) AS col, f.embed, f.method, f.op, f.role, f.enforced, f.via, f.file, f.site, f.func
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
  SELECT 'filter-column', f.site, f.func, f.rel, coalesce(f.col, '(klucz glowny?)'), f.role, f.enforced,
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
          AND CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                                 WHERE a.attrelid = ${rel("f.rel")} AND a.attname = f.col
                                   AND a.attnum > 0 AND NOT a.attisdropped)
                   THEN NOT has_column_privilege(f.role, ${rel("f.rel")}, f.col, 'SELECT')
                   ELSE false END)
  UNION ALL
  SELECT 'embed-column', m.site, m.func, c.relname::text, col.col, m.role, m.enforced,
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_attribute a
                                WHERE a.attrelid = x.target AND a.attname = col.col
                                  AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'kolumna nie istnieje' ELSE 'brak SELECT' END
           || ' (osadzenie ' || m.path || ' w ' || m.tbl
           || CASE WHEN m.file <> m.site THEN ', literal w ' || m.file ELSE '' END || ')',
         m.via
    FROM obs_embed m
    JOIN obs_embed_rel x ON x.id = m.id AND x.target IS NOT NULL
    JOIN pg_class c ON c.oid = x.target
    CROSS JOIN LATERAL (
      SELECT a.attname::text AS col FROM pg_attribute a
       WHERE a.attrelid = x.target AND a.attnum > 0 AND NOT a.attisdropped
         AND (m.star OR a.attname = ANY (m.cols))
      UNION
      SELECT y FROM unnest(m.cols) y
    ) col
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = x.target AND a.attname = col.col
                        AND a.attnum > 0 AND NOT a.attisdropped)
      OR (m.role IN ${roles}
          AND NOT has_column_privilege(m.role, x.target, col.col, 'SELECT'))
) v;
${PROBE_SQL}
SELECT p.kind, coalesce(p.outcome, 'nie uruchomiona') AS outcome, count(*) AS probes
  FROM obs_probe p
 GROUP BY 1, 2
 ORDER BY 1, 2;

SELECT x.kind, x.site, x.func, x.rel, x.col, x.role, x.enforced, x.problem, x.via, x.caught_by,
       coalesce(r.cls || ' ' || coalesce(r.entry, '') || ': ' || r.path, '-') AS reach
  FROM (
  SELECT kind, site, func, rel, col, role, enforced, problem, via, 'privilege-check' AS caught_by
    FROM obs_violation
  UNION ALL
  SELECT DISTINCT p.kind, p.site, p.func, p.rel, p.cols, p.role, p.enforced,
         p.msg || CASE WHEN EXISTS (SELECT 1 FROM obs_violation v
                                     WHERE v.site = p.site AND v.func = p.func
                                       AND v.rel = p.rel AND v.role = p.role)
                       THEN '' ELSE ' (tylko sonda)' END,
         p.via, 'execution-probe'
    FROM obs_probe p
   WHERE p.outcome = 'brak uprawnienia'
) x
LEFT JOIN obs_reach r ON r.site = x.site
ORDER BY x.caught_by DESC, x.kind, x.site, x.func, x.rel, x.col, x.role;
ROLLBACK;
`;
}

/**
 * Relacje osadzeń miary, jak rozwiązuje je PostgREST: nazwa relacji z listy
 * `select`, a bez takiej relacji - nazwa klucza obcego albo kolumny z kluczem
 * obcym relacji nadrzędnej. Klucz złączenia to JEDYNY klucz obcy między
 * relacjami (z podpowiedzią `!fk` - wskazany); inaczej `NULL` (sonda bez
 * złączenia). Relacja spoza `public` nie jest wystawiona przez PostgREST -
 * nieczytelna. Zagnieżdżenia rozwiązuje rekurencja od tabeli łańcucha.
 */
const EMBED_FUNCTIONS_SQL = `CREATE FUNCTION pg_temp.ts_embed(p_parent oid, p_rel text, p_hint text, OUT target oid, OUT fk oid)
LANGUAGE plpgsql STABLE AS $f$
DECLARE
  v_fks oid[];
BEGIN
  IF p_parent IS NULL THEN RETURN; END IF;
  target := to_regclass('public.' || quote_ident(p_rel));
  IF target IS NULL THEN
    SELECT array_agg(c.oid) INTO v_fks FROM pg_constraint c
     WHERE c.contype = 'f' AND c.conrelid = p_parent
       AND (c.conname = p_rel OR (cardinality(c.conkey) = 1 AND EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1] AND a.attname = p_rel)));
    IF cardinality(v_fks) = 1 THEN
      fk := v_fks[1];
      SELECT c.confrelid INTO target FROM pg_constraint c WHERE c.oid = fk;
    END IF;
  ELSE
    SELECT array_agg(c.oid) INTO v_fks FROM pg_constraint c
     WHERE c.contype = 'f'
       AND ((c.conrelid = p_parent AND c.confrelid = target)
            OR (c.conrelid = target AND c.confrelid = p_parent))
       AND (p_hint IS NULL OR c.conname = p_hint OR (cardinality(c.conkey) = 1 AND EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1] AND a.attname = p_hint)));
    IF cardinality(v_fks) = 1 THEN fk := v_fks[1]; END IF;
  END IF;
  IF target IS NOT NULL
     AND (SELECT relnamespace FROM pg_class WHERE oid = target) <> 'public'::regnamespace THEN
    target := NULL;
    fk := NULL;
  END IF;
END $f$;

-- Warunek zlaczenia po kluczu obcym: p - relacja nadrzedna, t - osadzona.
CREATE FUNCTION pg_temp.ts_fk_join(p_fk oid, p_parent oid)
RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT string_agg(CASE WHEN c.conrelid = p_parent
                         THEN format('p.%I = t.%I', a.attname, b.attname)
                         ELSE format('t.%I = p.%I', a.attname, b.attname) END, ' AND ' ORDER BY k.o)
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY k(src, dst, o)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.src
    JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = k.dst
   WHERE c.oid = p_fk
$f$;
`;

/** Tabela relacji osadzeń `target` (id, rodzic, relacja, klucz obcy) z faktów osadzeń `source`. */
function embedRelSql(source: string, target: string): string {
  return `CREATE TEMP TABLE ${target} ON COMMIT DROP AS
WITH RECURSIVE e AS (SELECT DISTINCT id, parent_id, tbl, rel, hint FROM ${source}),
r AS (
  SELECT e.id, to_regclass('public.' || quote_ident(e.tbl))::oid AS parent, x.target, x.fk
    FROM e CROSS JOIN LATERAL pg_temp.ts_embed(to_regclass('public.' || quote_ident(e.tbl)), e.rel, e.hint) x
   WHERE e.parent_id IS NULL
  UNION ALL
  SELECT e.id, r.target, x.target, x.fk
    FROM r JOIN e ON e.parent_id = r.id
    CROSS JOIN LATERAL pg_temp.ts_embed(r.target, e.rel, e.hint) x
)
SELECT id, parent, target, fk FROM r;
`;
}

const EMBED_SQL = `-- Relacje osadzen (tabela obs_embed_rel: id, rodzic, relacja, klucz obcy).
${EMBED_FUNCTIONS_SQL}
${embedRelSql("obs_embed", "obs_embed_rel")}`;

/**
 * Sondy wykonania miary (opis w `renderObservedQueries`): tabela `obs_probe`
 * z instrukcją każdej sondy, jej wykonanie jako rola zmierzona w podtransakcji
 * kończonej wyjątkiem wartownika i klasyfikacja wyniku.
 */
/** Nazwy tabel sond wykonania: miara (`obs_*`) albo bramka pgTAP (`ts_obs_*`). */
interface ProbeSqlNames {
  readonly probe: string;
  readonly stmt: string;
  readonly filterCols: string;
  readonly rpc: string;
  readonly embed: string;
  readonly embedRel: string;
  /** Kolumna `guest` (wiersz gościa) w tabelach źródłowych i w tabeli sond - bramka. */
  readonly guest: boolean;
  /** Funkcje wyłączone z sond RPC (bramka: `RPC_PROBE_EXCLUDED`); `null` - bez listy (miara). */
  readonly rpcExcluded: readonly string[] | null;
  /** Przypisanie `v_outcome := CASE ...` klasyfikacji wyniku sondy (PL/pgSQL). */
  readonly outcome: string;
}

/** Klasyfikacja wyniku sondy miary: naruszenie to wyłącznie 42501 „permission denied for …". */
const MEASURE_PROBE_OUTCOME = `      v_outcome := CASE WHEN v_state = '00000' THEN 'ok'
                        WHEN v_state = '42501' AND v_msg LIKE 'permission denied for %' THEN 'brak uprawnienia'
                        WHEN v_state = '42501' THEN 'odmowa autoryzacji (RAISE 42501)'
                        WHEN v_state IN ('57014', '55P03') THEN 'przekroczony czas'
                        ELSE 'inny blad ' || v_state END;
`;

/**
 * Funkcje pomocnicze sond (lista identyfikatorów, klucz główny, wartość
 * syntetyczna typu, argumenty RPC z NULL-ami albo syntetyczne) - wspólne dla
 * miary i bramki, żeby obie budowały TE SAME sondy.
 */
const PROBE_HELPERS_SQL = `-- Lista identyfikatorow wedlug formatu (\`%I\`, \`%1$I = EXCLUDED.%1$I\`, \`DEFAULT\`).
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

-- Wartosc syntetyczna typu (druga sonda RPC: cialo za straznikiem argumentu
-- NULL tez sie wykonuje). Stala, bez losowosci: uuid ...0aa, 'x', 1, false,
-- '{}', 2026-01-01, przedzial pusty, tablica jednego elementu, pierwsza
-- etykieta enuma, domena - wartosc typu bazowego, typ zlozony - ROW(...);
-- typ bez reguly (i zagniezdzenie ponad 3) - NULL tego typu.
CREATE FUNCTION pg_temp.ts_synth(p_type oid, p_depth int DEFAULT 0)
RETURNS text LANGUAGE plpgsql STABLE AS $f$
DECLARE
  t record;
  v text;
  v_name text := format_type(p_type, NULL);
BEGIN
  SELECT typtype, typcategory, typelem, typbasetype, typrelid INTO t FROM pg_type WHERE oid = p_type;
  IF NOT FOUND OR p_depth > 3 THEN
    RETURN format('NULL::%s', v_name);
  ELSIF t.typtype = 'd' THEN
    RETURN format('(%s)::%s', pg_temp.ts_synth(t.typbasetype, p_depth + 1), v_name);
  ELSIF t.typtype = 'e' THEN
    SELECT format('%L::%s', e.enumlabel, v_name) INTO v
      FROM pg_enum e WHERE e.enumtypid = p_type ORDER BY e.enumsortorder LIMIT 1;
  ELSIF t.typtype = 'c' THEN
    SELECT format('ROW(%s)::%s', string_agg(pg_temp.ts_synth(a.atttypid, p_depth + 1), ', ' ORDER BY a.attnum), v_name)
      INTO v
      FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped;
  ELSIF t.typcategory = 'A' AND t.typelem <> 0 THEN
    RETURN format('ARRAY[%s]::%s', pg_temp.ts_synth(t.typelem, p_depth + 1), v_name);
  ELSIF t.typtype IN ('r', 'm') THEN
    v := format('%L::%s', CASE t.typtype WHEN 'r' THEN 'empty' ELSE '{}' END, v_name);
  ELSE
    v := CASE
           WHEN p_type = 'uuid'::regtype THEN '00000000-0000-4000-8000-0000000000aa'
           WHEN p_type IN ('json'::regtype, 'jsonb'::regtype) THEN '{}'
           WHEN p_type = 'bool'::regtype THEN 'false'
           WHEN p_type = 'date'::regtype THEN '2026-01-01'
           WHEN p_type IN ('timestamp'::regtype, 'timestamptz'::regtype) THEN '2026-01-01 00:00:00+00'
           WHEN p_type IN ('time'::regtype, 'timetz'::regtype) THEN '00:00:00+00'
           WHEN p_type = 'interval'::regtype THEN '1 day'
           WHEN p_type IN ('inet'::regtype, 'cidr'::regtype) THEN '127.0.0.1'
           WHEN t.typcategory = 'N' THEN '1'
           WHEN t.typcategory = 'S' THEN 'x'
         END;
    IF v IS NOT NULL THEN v := format('%L::%s', v, v_name); END IF;
  END IF;
  RETURN coalesce(v, format('NULL::%s', v_name));
END $f$;

-- Argumenty wywolania RPC z NULL-ami (\`p_synth\` - z wartosciami syntetycznymi):
-- klucze z kodu (nazwane), a gdy kluczy nie da sie ustalic - kazdy parametr
-- bez DEFAULT; jedyny nienazwany parametr (json PostgREST) - pozycyjnie.
CREATE FUNCTION pg_temp.ts_rpc_args(p_oid oid, p_keys text[], p_synth boolean DEFAULT false)
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
      v_out := v_out || CASE WHEN p_synth THEN pg_temp.ts_synth(v_types[i])
                             ELSE format('NULL::%s', format_type(v_types[i], NULL)) END;
    ELSIF (p_keys IS NOT NULL AND v_names[i] = ANY (p_keys))
       OR (p_keys IS NULL AND v_pos <= p.pronargs - p.pronargdefaults) THEN
      v_out := v_out || format('%s%I => %s', CASE WHEN v_modes[i] = 'v' THEN 'VARIADIC ' ELSE '' END,
                               v_names[i],
                               CASE WHEN p_synth THEN pg_temp.ts_synth(v_types[i])
                                    ELSE format('NULL::%s', format_type(v_types[i], NULL)) END);
    END IF;
  END LOOP;
  RETURN array_to_string(v_out, ', ');
END $f$;

`;

/**
 * Limity czasu sond. Postgres uzbraja `statement_timeout` WYŁĄCZNIE na
 * początku instrukcji najwyższego poziomu: `set_config('statement_timeout',
 * ..., true)` wewnątrz bloku DO nie przerywa bieżącej instrukcji (PG16: 200 ms
 * ustawione w DO, `pg_sleep(1)` doszedł do końca). Dlatego sondy wykonuje
 * funkcja wołana z kolejnych instrukcji DO (partie): każda instrukcja dostaje
 * własny limit `PROBE_STATEMENT_TIMEOUT`, a partia sama kończy się po
 * `PROBE_BATCH_BUDGET`, więc KAŻDA sonda ma co najmniej różnicę obu (8 s).
 * `lock_timeout` działa w trakcie instrukcji - ustawiany na sondę w jej
 * podtransakcji (`set_config(..., true)`, cofany razem z nią).
 */
const PROBE_STATEMENT_TIMEOUT = "10s";
const PROBE_BATCH_BUDGET = "2s";
const PROBE_LOCK_TIMEOUT = "5s";
/** Partie sond: lokalnie wystarczają 2-3 (~4 s sond), puste wracają od razu. */
const PROBE_BATCHES = 30;

function probeSql(n: ProbeSqlNames): string {
  const g = (expr: string): string => (n.guest ? ` ${expr},` : "");
  const run = `pg_temp.${n.probe}_run`;
  // 57014 po limicie instrukcji (a nie anulowanie z zewnątrz): od początku
  // instrukcji minął limit; bez zależności od języka komunikatu.
  const timedOut = `clock_timestamp() - statement_timestamp() >= interval '${PROBE_STATEMENT_TIMEOUT}' - interval '1 s'`;
  const batches = Array.from(
    { length: PROBE_BATCHES },
    () => `DO $run$ BEGIN PERFORM ${run}(); END $run$;`,
  ).join("\n");
  return `-- ── Sondy wykonania ─────────────────────────────────────────────────────────
CREATE TEMP TABLE ${n.probe} (
  id serial PRIMARY KEY, kind text, site text, func text, rel text, cols text,
  role text, enforced text, via text,${n.guest ? " guest boolean," : ""} sql text, state text, msg text, ctx text, outcome text,
  touched bigint
) ON COMMIT DROP;

${PROBE_HELPERS_SQL}-- Zapytania lancuchow: odczyt jako SELECT ... LIMIT 1 - kolumny widoku i funkcje
-- wiersza licza sie dla jednego wiersza (jest, gdy relacja ma dane); kolumny
-- filtrow zostaja w WHERE (uprawnienia sprawdza start wykonania), \`OR true\`
-- nie odrzuca wiersza. Zapis jako EXPLAIN.
INSERT INTO ${n.probe} (kind, site, func, rel, cols, role, enforced, via,${g("guest")} sql)
SELECT 'probe-' || s.op, s.site, s.func, s.rel,
       concat_ws(' ', CASE WHEN s.star THEN '*' ELSE array_to_string(s.cols, ',') END,
                 nullif('ladunek(' || array_to_string(s.payload, ',') || ')', 'ladunek()'),
                 nullif('where(' || array_to_string(s.where_cols, ',') || ')', 'where()')),
       s.role, s.enforced, s.via,${g("s.guest")}
       CASE s.op
         WHEN 'select' THEN format('SELECT %s FROM public.%I%s LIMIT 1',
           CASE WHEN s.star THEN '*' ELSE coalesce(pg_temp.ts_list(s.cols, '%I', ', '), '') END,
           s.rel, ws.clause)
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
  FROM ${n.stmt} s
  CROSS JOIN LATERAL (SELECT coalesce(' WHERE ' || pg_temp.ts_list(s.where_cols, '%I IS NULL', ' AND '), '') AS clause) w
  CROSS JOIN LATERAL (SELECT coalesce(' WHERE (' || pg_temp.ts_list(s.where_cols, '%I IS NULL', ' AND ') || ') OR true', '') AS clause) ws
  CROSS JOIN LATERAL (SELECT CASE WHEN s.star THEN ' RETURNING *'
                                  ELSE coalesce(' RETURNING ' || pg_temp.ts_list(s.cols, '%I', ', '), '') END AS clause) r
  CROSS JOIN LATERAL (SELECT pg_temp.ts_list(CASE WHEN s.conflict = ARRAY['${PRIMARY_KEY_COLUMNS}']
                                                  THEN pg_temp.ts_pk(s.rel) ELSE s.conflict END,
                                             '%I', ', ') AS cols) t
 WHERE s.role IN ('anon', 'authenticated', 'service_role')
   AND to_regclass('public.' || quote_ident(s.rel)) IS NOT NULL;

-- Kazda kolumna filtra osobno (takze osadzenia i budowniczy przez wartosc);
-- LIMIT 1 - kolumna widoku liczona funkcja liczy sie w WHERE.
INSERT INTO ${n.probe} (kind, site, func, rel, cols, role, enforced, via,${g("guest")} sql)
SELECT DISTINCT 'probe-filter', f.site, f.func, f.rel, f.col, f.role, f.enforced, f.via,${g("f.guest")}
       format('SELECT FROM public.%I WHERE %I IS NULL LIMIT 1', f.rel, f.col)
  FROM ${n.filterCols} f
 WHERE f.role IN ('anon', 'authenticated', 'service_role') AND f.col IS NOT NULL
   AND to_regclass('public.' || quote_ident(f.rel)) IS NOT NULL;

-- RPC: funkcje SECURITY INVOKER wolane przez anon/authenticated, z EXECUTE
-- (brak EXECUTE zglasza juz sprawdzenie uprawnien). Dwie sondy: argumenty NULL
-- (\`probe-rpc\`) i syntetyczne (\`probe-rpc-synth\`, pg_temp.ts_synth) - cialo za
-- straznikiem \`IF arg IS NULL THEN RETURN\` tez sie wykonuje; funkcja bez
-- argumentow - jedna sonda.
INSERT INTO ${n.probe} (kind, site, func, rel, cols, role, enforced, via,${g("guest")} sql)
SELECT DISTINCT a.kind, r.site, r.func, r.fn, coalesce(array_to_string(r.keys, ','), '?'),
       r.role, r.enforced, r.via,${g("r.guest")} format('SELECT public.%I(%s)', p.proname, a.args)
  FROM ${n.rpc} r
  -- Przeciazenie liczone RAZ na wiersz (LATERAL): \`p.oid IN (podzapytanie)\`
  -- liczylo ts_rpc_match dla kazdej pary (wiersz, funkcja z pg_proc) - minuta.
  CROSS JOIN LATERAL (
         SELECT pg_temp.ts_rpc_match(r.fn, r.keys) AS oid WHERE r.keys IS NOT NULL
         UNION ALL
         SELECT q.oid FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
          WHERE r.keys IS NULL AND n.nspname = 'public' AND q.proname = r.fn) o
  JOIN pg_proc p ON p.oid = o.oid
  CROSS JOIN LATERAL (
         SELECT 'probe-rpc' AS kind, pg_temp.ts_rpc_args(p.oid, r.keys) AS args, true AS differs
         UNION ALL
         SELECT 'probe-rpc-synth', s.args, s.args <> pg_temp.ts_rpc_args(p.oid, r.keys)
           FROM (SELECT pg_temp.ts_rpc_args(p.oid, r.keys, true) AS args) s) a
 WHERE r.role IN ('anon', 'authenticated')
   AND NOT p.prosecdef AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype
   AND has_function_privilege(r.role, p.oid, 'EXECUTE')${n.rpcExcluded === null ? "" : `\n   AND p.proname <> ALL (${sqlTextArray(n.rpcExcluded)})`}
   AND a.differs;

-- Osadzenia: kolumny relacji osadzonej ZE zlaczeniem po kluczu obcym (SELECT
-- na kolumnach klucza po obu stronach, LIMIT 1 - kolumny widoku dla wiersza);
-- bez jednoznacznego klucza - sama relacja; relacja nieczytelna - tylko
-- w podsumowaniu.
INSERT INTO ${n.probe} (kind, site, func, rel, cols, role, enforced, via,${g("guest")} sql, outcome)
SELECT DISTINCT 'probe-embed', m.site, m.func, coalesce(c.relname::text, m.rel),
       m.path || '(' || CASE WHEN m.star THEN '*' ELSE array_to_string(m.cols, ',') END || ')',
       m.role, m.enforced, m.via,${g("m.guest")}
       CASE WHEN x.target IS NULL THEN NULL
            WHEN x.fk IS NULL THEN format('SELECT %s FROM public.%I t LIMIT 1', tc.list, c.relname)
            ELSE format('SELECT %s FROM public.%I p JOIN public.%I t ON %s LIMIT 1', tc.list,
                        pc.relname, c.relname, pg_temp.ts_fk_join(x.fk, x.parent)) END,
       CASE WHEN x.target IS NULL THEN 'relacja osadzenia nieczytelna' END
  FROM ${n.embed} m
  JOIN ${n.embedRel} x ON x.id = m.id
  LEFT JOIN pg_class c ON c.oid = x.target
  LEFT JOIN pg_class pc ON pc.oid = x.parent
  CROSS JOIN LATERAL (SELECT CASE WHEN m.star THEN 't.*'
                                  ELSE coalesce(pg_temp.ts_list(m.cols, 't.%I', ', '), '') END AS list) tc
 WHERE m.role IN ('anon', 'authenticated', 'service_role');

-- Wykonanie sond: funkcja wolana z kolejnych instrukcji DO (partie). Limit
-- instrukcji (${PROBE_STATEMENT_TIMEOUT}) Postgres uzbraja tylko na poczatku instrukcji najwyzszego
-- poziomu, wiec partia konczy sie sama po ${PROBE_BATCH_BUDGET}, a nastepna DO uzbraja go od
-- nowa. Sonda przerwana limitem (57014) albo blokada (55P03, lock_timeout
-- ${PROBE_LOCK_TIMEOUT} w podtransakcji sondy) i sonda bez wyniku po ostatniej partii to
-- naruszenie z plikiem i funkcja; ASSERT funkcji (P0004) i inne bledy - wynik
-- sondy, nie przerwanie pliku.
CREATE FUNCTION ${run}() RETURNS void LANGUAGE plpgsql AS $run$
DECLARE
  v_ids int[];
  v_roles text[];
  v_sqls text[];
  v_rpc boolean[];
  v_rels oid[];
  v_before bigint;
  v_touched bigint[] := '{}';
  v_done int[] := '{}';
  v_states text[] := '{}';
  v_msgs text[] := '{}';
  v_ctxs text[] := '{}';
  v_outcomes text[] := '{}';
  v_state text;
  v_msg text;
  v_ctx text;
  v_outcome text;
  v_sub text;
  v_email text;
  v_host text;
  v_stop boolean := false;
  i int;
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
  -- Ta sama instrukcja tej samej roli (inne miejsce wywolania) wykonuje sie
  -- RAZ - wynik dostaja wszystkie jej wiersze (kazda sonda jest wycofywana,
  -- wiec stan bazy miedzy sondami sie nie zmienia).
  SELECT array_agg(g.id ORDER BY g.id), array_agg(g.role ORDER BY g.id), array_agg(g.sql ORDER BY g.id),
         array_agg(g.rpc ORDER BY g.id)
    INTO v_ids, v_roles, v_sqls, v_rpc
    FROM (SELECT min(id) AS id, role, sql, bool_or(kind LIKE 'probe-rpc%') AS rpc FROM ${n.probe}
           WHERE sql IS NOT NULL AND state IS NULL GROUP BY role, sql) g;
  -- Relacje poza katalogiem: liczniki odczytow tej sesji (pg_stat_get_xact_*,
  -- nietransakcyjne - przezywaja wycofanie sondy) mowia, czy cialo RPC
  -- przeczytalo cokolwiek; NULL przy track_counts = off.
  IF current_setting('track_counts')::boolean THEN
    SELECT array_agg(c.oid ORDER BY c.oid) INTO v_rels
      FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'm', 'i')
       AND s.nspname NOT IN ('pg_catalog', 'information_schema') AND s.nspname !~ '^pg_(toast|temp)';
  END IF;
  FOR i IN 1 .. coalesce(cardinality(v_ids), 0) LOOP
    -- Oslona: limit instrukcji trafiajacy MIEDZY sondami nie przerywa pliku -
    -- sonda zostaje bez wyniku dla nastepnej partii.
    BEGIN
      EXIT WHEN clock_timestamp() - statement_timestamp() > interval '${PROBE_BATCH_BUDGET}';
      BEGIN
        PERFORM set_config('lock_timeout', '${PROBE_LOCK_TIMEOUT}', true);
        PERFORM set_config('request.jwt.claims',
          CASE WHEN v_roles[i] = 'authenticated'
               THEN json_build_object('sub', v_sub, 'role', v_roles[i], 'aud', 'authenticated', 'email', v_email)
               ELSE json_build_object('role', v_roles[i]) END::text, true);
        PERFORM set_config('request.jwt.claim.sub', CASE WHEN v_roles[i] = 'authenticated' THEN v_sub ELSE '' END, true);
        PERFORM set_config('request.jwt.claim.role', v_roles[i], true);
        PERFORM set_config('request.headers', json_build_object('x-tenant-host', v_host)::text, true);
        PERFORM set_config('role', v_roles[i], true);
        IF v_rpc[i] THEN
          SELECT sum(pg_stat_get_xact_numscans(o) + pg_stat_get_xact_tuples_returned(o)
                     + pg_stat_get_xact_tuples_fetched(o))
            INTO v_before FROM unnest(v_rels) o;
        END IF;
        EXECUTE v_sqls[i];
        -- Wartownik: wycofuje podtransakcje (zapisy funkcji, role, roszczenia, lock_timeout).
        RAISE SQLSTATE 'PRB00';
      EXCEPTION
        WHEN SQLSTATE 'PRB00' THEN
          v_state := '00000'; v_msg := NULL; v_ctx := NULL;
        -- WHEN OTHERS nie lapie ASSERT (P0004) ani anulowania (57014).
        WHEN assert_failure OR query_canceled THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
          -- Anulowanie z zewnatrz (nie limit instrukcji) przerywa plik.
          IF v_state = '57014' AND NOT (${timedOut}) THEN
            RAISE;
          END IF;
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
      END;
${n.outcome}      v_done := v_done || v_ids[i];
      v_states := v_states || v_state;
      v_msgs := v_msgs || v_msg;
      v_ctxs := v_ctxs || left(v_ctx, 400);
      v_outcomes := v_outcomes || v_outcome;
      v_touched := v_touched || CASE WHEN v_rpc[i] THEN
        (SELECT sum(pg_stat_get_xact_numscans(o) + pg_stat_get_xact_tuples_returned(o)
                    + pg_stat_get_xact_tuples_fetched(o)) FROM unnest(v_rels) o) - v_before END;
      -- Limit tej instrukcji zuzyty - dalsze sondy w nastepnej partii.
      v_stop := v_state = '57014';
    EXCEPTION WHEN query_canceled THEN
      IF NOT (${timedOut}) THEN
        RAISE;
      END IF;
      v_stop := true;
    END;
    EXIT WHEN v_stop;
  END LOOP;
  -- Wyniki partii jednym UPDATE (podtransakcje sond bez wlasnych zapisow),
  -- na kazdy wiersz tej samej roli i instrukcji.
  BEGIN
    UPDATE ${n.probe} p SET state = x.state, msg = x.msg, ctx = x.ctx, outcome = x.outcome, touched = x.touched
      FROM unnest(v_done, v_states, v_msgs, v_ctxs, v_outcomes, v_touched) AS x(id, state, msg, ctx, outcome, touched)
      JOIN ${n.probe} d ON d.id = x.id
     WHERE p.role = d.role AND p.sql = d.sql AND p.state IS NULL;
  EXCEPTION WHEN query_canceled THEN
    -- Limit w trakcie zapisu wynikow: partia przepada, nastepna wykona ja od nowa.
    IF NOT (${timedOut}) THEN
      RAISE;
    END IF;
  END;
END $run$;

CREATE TEMP TABLE ${n.probe}_guc ON COMMIT DROP AS SELECT current_setting('statement_timeout') AS statement_timeout;
SET LOCAL statement_timeout = '${PROBE_STATEMENT_TIMEOUT}';
${batches}
-- Limit instrukcji wraca do wartosci sprzed sond (SET LOCAL i tak cofa ROLLBACK).
DO $run$ BEGIN PERFORM set_config('statement_timeout', (SELECT statement_timeout FROM ${n.probe}_guc), true); END $run$;
UPDATE ${n.probe} SET outcome = 'nie uruchomiona' WHERE sql IS NOT NULL AND state IS NULL;
`;
}

const PROBE_SQL = probeSql({
  probe: "obs_probe",
  stmt: "obs_stmt",
  filterCols: "obs_filter_cols",
  rpc: "obs_rpc",
  embed: "obs_embed",
  embedRel: "obs_embed_rel",
  guest: false,
  rpcExcluded: null,
  outcome: MEASURE_PROBE_OUTCOME,
});
