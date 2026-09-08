import { splitSqlStatements } from "./authzGates";
// Kontrakt schematu bazy dla bramki CI "po każdym wdrożeniu".
//
// Migracje są forward-only, więc oczekiwany stan bazy = wszystkie obiekty
// utworzone w migracjach MINUS te, które później zostały usunięte lub
// przemianowane. Ten moduł jest CZYSTY (bez I/O, bez sieci) - skrypt
// scripts/check-db-contract.ts dokłada odczyt plików i sondowanie PostgREST,
// dzięki czemu cała logika parsowania jest testowalna jednostkowo.
export type DbObjectKind = "table" | "view" | "function";

export interface DbObject {
  readonly kind: DbObjectKind;
  /** Nazwa bez schematu (kontrakt dotyczy wyłącznie schematu `public`). */
  readonly name: string;
  /** Plik migracji, w którym obiekt pojawił się po raz ostatni. */
  readonly file: string;
}

export interface MigrationFile {
  readonly file: string;
  readonly sql: string;
}

export interface ExpectedContract {
  readonly tables: readonly DbObject[];
  readonly views: readonly DbObject[];
  readonly functions: readonly DbObject[];
}

/** Wynik sondy pojedynczego obiektu przez Data API. */
export type ProbeVerdict = "present" | "missing" | "inconclusive";

const PUBLIC_PREFIX = /^public\./;

function normalizeName(raw: string): string | null {
  const cleaned = raw.replace(/"/g, "").trim().toLowerCase();
  // Kontrakt obejmuje tylko schemat public (auth/storage/realtime są zarządzane).
  if (cleaned.includes(".") && !PUBLIC_PREFIX.test(cleaned)) return null;
  const name = cleaned.replace(PUBLIC_PREFIX, "");
  return /^[a-z0-9_]+$/.test(name) ? name : null;
}

/**
 * Funkcje wyzwalaczy (RETURNS trigger) NIE są wystawiane przez PostgREST,
 * więc nie da się ich sondować przez Data API - wypadają z kontraktu.
 */
function returnsTrigger(sqlAfterSignature: string): boolean {
  return /\breturns\s+trigger\b/i.test(sqlAfterSignature.slice(0, 400));
}

/**
 * Buduje oczekiwany zbiór obiektów `public` ze wszystkich migracji
 * (posortowanych chronologicznie - kolejność wejścia jest kolejnością stosowania).
 */
export function extractExpectedContract(files: readonly MigrationFile[]): ExpectedContract {
  const tables = new Map<string, DbObject>();
  const views = new Map<string, DbObject>();
  const functions = new Map<string, DbObject>();

  const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const createView =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const createFn = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_."]+)\s*\(/gi;
  const dropTable = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const dropView = /DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const dropFn = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const renameTable =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s+RENAME\s+TO\s+([A-Za-z0-9_."]+)/gi;

  const runCreate = (
    re: RegExp,
    sql: string,
    file: string,
    target: Map<string, DbObject>,
    kind: DbObjectKind,
  ) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const name = normalizeName(m[1]);
      if (name === null) continue;
      if (kind === "function" && returnsTrigger(sql.slice(m.index + m[0].length))) continue;
      target.set(name, { kind, name, file });
    }
  };

  const runDrop = (re: RegExp, sql: string, target: Map<string, DbObject>) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const name = normalizeName(m[1]);
      if (name !== null) target.delete(name);
    }
  };

  for (const { file, sql: migration } of files) {
    // Preserve DROP/CREATE and RENAME order within one migration.
    for (const sql of splitSqlStatements(migration)) {
      runCreate(createTable, sql, file, tables, "table");
      runCreate(createView, sql, file, views, "view");
      runCreate(createFn, sql, file, functions, "function");
      runDrop(dropTable, sql, tables);
      runDrop(dropView, sql, views);
      runDrop(dropFn, sql, functions);

      renameTable.lastIndex = 0;
      let rename: RegExpExecArray | null;
      while ((rename = renameTable.exec(sql)) !== null) {
        const from = normalizeName(rename[1]);
        const to = normalizeName(rename[2]);
        if (from === null) continue;
        tables.delete(from);
        if (to !== null) tables.set(to, { kind: "table", name: to, file });
      }
    }
  }

  const sorted = (map: Map<string, DbObject>): DbObject[] =>
    [...map.values()].sort((a, b) => a.name.localeCompare(b.name));

  return { tables: sorted(tables), views: sorted(views), functions: sorted(functions) };
}

/**
 * Tłumaczy odpowiedź Data API na werdykt istnienia obiektu.
 *
 * - `PGRST205` = tabeli/widoku nie ma w cache schematu → brak obiektu.
 * - `PGRST202` jest niejednoznaczny: PostgREST zwraca go ZARÓWNO gdy funkcji
 *   nie ma, JAK I gdy istnieje pod inną sygnaturą niż sondowana (my sondujemy
 *   bezpiecznie, bez argumentów, żeby niczego nie wywołać). Rozróżnia je
 *   `hint`: dla nieznanej nazwy PostgREST podpowiada INNĄ, najbliższą funkcję
 *   ("Perhaps you meant to call the function public.X"); gdy nazwa istnieje
 *   i nie zgadzają się tylko argumenty - `hint` jest pusty.
 * - 401/403/42501 to brak uprawnień - obiekt ISTNIEJE (RLS/GRANT to inne bramki).
 * - 400 (np. zły typ argumentu RPC) też oznacza, że funkcja istnieje.
 */
export function classifyProbe(
  status: number,
  code: string | null,
  hint?: string | null,
): ProbeVerdict {
  if (code === "PGRST205") return "missing";
  if (code === "PGRST202") {
    return typeof hint === "string" && hint.trim() !== "" ? "missing" : "present";
  }
  if (status >= 200 && status < 300) return "present";
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    // 404 bez kodu PGRST20x nie rozstrzyga (np. proxy/edge), reszta = istnieje.
    return status === 404 ? "inconclusive" : "present";
  }
  if (status === 409 || status === 422 || status === 500) return "present";
  return "inconclusive";
}

export interface ContractReport {
  readonly checked: number;
  readonly missing: readonly DbObject[];
  readonly inconclusive: readonly DbObject[];
}

/** Czy raport powinien zablokować CI. */
export function contractFailed(report: ContractReport): boolean {
  return report.missing.length > 0;
}

/** Renderuje raport w formacie Markdown (do logu CI / GitHub Step Summary). */
export function renderContractReport(report: ContractReport): string {
  const lines: string[] = [
    "## Kontrakt bazy danych (tabele / widoki / RPC)",
    "",
    `- Sprawdzonych obiektów: **${report.checked}**`,
    `- Brakujących: **${report.missing.length}**`,
    `- Nierozstrzygniętych: **${report.inconclusive.length}**`,
  ];
  if (report.missing.length > 0) {
    lines.push("", "### Brakujące obiekty");
    for (const o of report.missing) lines.push(`- \`${o.kind} ${o.name}\` (migracja: ${o.file})`);
  }
  if (report.inconclusive.length > 0) {
    lines.push("", "### Nierozstrzygnięte (do ręcznego sprawdzenia)");
    for (const o of report.inconclusive) lines.push(`- \`${o.kind} ${o.name}\``);
  }
  return lines.join("\n");
}
