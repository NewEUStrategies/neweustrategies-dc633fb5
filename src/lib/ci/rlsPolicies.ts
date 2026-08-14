// Wspólny parser polityk RLS z forward-only migracji - fundament bramek CI,
// które rozumują o STANIE KOŃCOWYM polityk, a nie o pojedynczych migracjach.
//
// Migracje są forward-only i w tym repo dominuje wzorzec „DROP POLICY IF EXISTS
// x; CREATE POLICY x …" w JEDNYM pliku, więc o rzeczywistym stanie bazy decyduje
// kolejność instrukcji, nie sam fakt wystąpienia CREATE. Dlatego zdarzenia
// (create/drop) są odtwarzane sekwencyjnie - najpierw po plikach (sort
// chronologiczny), potem po pozycji w pliku.
//
// Moduł jest CZYSTY (bez I/O): skrypty w `scripts/` dokładają odczyt plików i
// `stripSqlComments`, dzięki czemu cała logika parsowania jest testowalna
// jednostkowo. WEJŚCIE MUSI BYĆ POZBAWIONE KOMENTARZY SQL - inaczej bramka
// trafia we własne nagłówki dokumentacyjne migracji, które cytują naprawiany
// wzorzec.
//
// Używane przez:
//   - scripts/check-sql-anon-insert.ts         (permisywny anonimowy INSERT)
//   - scripts/check-sql-owner-tenant-scope.ts  (izolacja tenanta w politykach właściciela)
import type { MigrationFile } from "./dbContract";

/** Komenda polityki; brak klauzuli `FOR` w SQL oznacza `ALL`. */
export type PolicyCommand = "all" | "select" | "insert" | "update" | "delete";

/** Znormalizowana wartość wyrażenia polityki (USING / WITH CHECK). */
export type PolicyExprKind = "true" | "false" | "other" | "none";

export interface PolicyDef {
  /** `tabela::nazwa` - klucz stanu końcowego. */
  readonly key: string;
  /** Nazwa tabeli bez schematu (polityki dotyczą wyłącznie schematu `public`). */
  readonly table: string;
  /** Nazwa polityki: bez cudzysłowów, lowercase. */
  readonly name: string;
  /** Plik migracji z OSTATNIM `CREATE POLICY` dla tego klucza. */
  readonly file: string;
  readonly command: PolicyCommand;
  /** Role z klauzuli `TO`; brak klauzuli = `public` (semantyka Postgresa). */
  readonly roles: ReadonlySet<string>;
  /** Treść `USING (…)` bez zewnętrznych nawiasów; `null` gdy klauzuli nie ma. */
  readonly using: string | null;
  /** Treść `WITH CHECK (…)` bez zewnętrznych nawiasów; `null` gdy klauzuli nie ma. */
  readonly withCheck: string | null;
}

const CREATE_HEAD = /CREATE\s+POLICY\s+("[^"]+"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)/gi;
const DROP_HEAD =
  /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)/gi;

/** Nazwa tabeli bez schematu i cudzysłowów. */
function normalizeTable(raw: string): string {
  return raw
    .replace(/"/g, "")
    .replace(/^[a-z0-9_]+\./i, "")
    .toLowerCase();
}

/** Nazwa polityki bez cudzysłowów, w lowercase (Postgres rozróżnia wielkość, my nie). */
function normalizeName(raw: string): string {
  return raw.replace(/"/g, "").trim().toLowerCase();
}

/**
 * Czyta od `fromIdx` do `;` na poziomie 0 nawiasów, pomijając literały `'…'`.
 * Średnik wewnątrz wyrażenia (np. w literale) nie kończy instrukcji.
 */
export function readStatementTail(sql: string, fromIdx: number): string {
  let depth = 0;
  let inSingle = false;
  for (let i = fromIdx; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === ";" && depth === 0) return sql.slice(fromIdx, i);
  }
  return sql.slice(fromIdx);
}

/** Zbalansowane wyrażenie w nawiasach po słowie kluczowym (USING / WITH CHECK). */
export function parenExprAfter(tail: string, keyword: RegExp): string | null {
  const m = keyword.exec(tail);
  if (m === null) return null;
  let i = m.index + m[0].length;
  while (i < tail.length && tail[i] !== "(") i += 1;
  if (i >= tail.length) return null;
  let depth = 0;
  const start = i;
  for (; i < tail.length; i += 1) {
    if (tail[i] === "(") depth += 1;
    else if (tail[i] === ")") {
      depth -= 1;
      if (depth === 0) return tail.slice(start + 1, i).trim();
    }
  }
  return null;
}

/** `true` / `false` / warunek / brak klauzuli. */
export function classifyExpr(expr: string | null): PolicyExprKind {
  if (expr === null) return "none";
  const normalized = expr.replace(/\s+/g, "").toLowerCase();
  if (normalized === "true") return "true";
  if (normalized === "false") return "false";
  return "other";
}

/** Wszystko przed pierwszym USING/WITH CHECK - tam żyją klauzule FOR i TO. */
function headOf(tail: string): string {
  return tail.split(/\bUSING\b|\bWITH\s+CHECK\b/i)[0];
}

function parseCommand(tail: string): PolicyCommand {
  const m = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(headOf(tail));
  return m === null ? "all" : (m[1].toLowerCase() as PolicyCommand);
}

function parseRoles(tail: string): ReadonlySet<string> {
  const m = /\bTO\s+([A-Za-z0-9_,"\s]+)/i.exec(headOf(tail));
  if (m === null) return new Set(["public"]);
  return new Set(
    m[1]
      .split(",")
      .map((role) => role.replace(/"/g, "").trim().toLowerCase())
      .filter((role) => role !== ""),
  );
}

interface PolicyEvent {
  readonly kind: "create" | "drop";
  readonly index: number;
  readonly key: string;
  readonly def?: PolicyDef;
}

function collectEvents(file: string, sql: string): PolicyEvent[] {
  const events: PolicyEvent[] = [];

  CREATE_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_HEAD.exec(sql)) !== null) {
    const table = normalizeTable(m[2]);
    const name = normalizeName(m[1]);
    const key = `${table}::${name}`;
    const tail = readStatementTail(sql, m.index + m[0].length);
    events.push({
      kind: "create",
      index: m.index,
      key,
      def: {
        key,
        table,
        name,
        file,
        command: parseCommand(tail),
        roles: parseRoles(tail),
        using: parenExprAfter(tail, /\bUSING\b/i),
        withCheck: parenExprAfter(tail, /\bWITH\s+CHECK\b/i),
      },
    });
  }

  DROP_HEAD.lastIndex = 0;
  while ((m = DROP_HEAD.exec(sql)) !== null) {
    events.push({
      kind: "drop",
      index: m.index,
      key: `${normalizeTable(m[2])}::${normalizeName(m[1])}`,
    });
  }

  return events.sort((a, b) => a.index - b.index);
}

/**
 * Stan końcowy wszystkich polityk RLS po zastosowaniu migracji po kolei.
 *
 * @param files migracje POSORTOWANE chronologicznie, z SQL bez komentarzy.
 */
export function extractLatestPolicies(files: readonly MigrationFile[]): Map<string, PolicyDef> {
  const policies = new Map<string, PolicyDef>();
  for (const { file, sql } of files) {
    for (const event of collectEvents(file, sql)) {
      if (event.kind === "drop") policies.delete(event.key);
      else if (event.def !== undefined) policies.set(event.key, event.def);
    }
  }
  return policies;
}

/**
 * HISTORIA definicji każdej polityki: wszystkie `CREATE POLICY` w kolejności
 * migracji, a w obrębie pliku - w kolejności wystąpienia.
 *
 * Uzupełnia `extractLatestPolicies` o wymiar, którego stan końcowy nie zna:
 * CZY POLITYKA KIEDYŚ COŚ UMIAŁA, a potem to straciła. `DROP POLICY` nie
 * wchodzi do historii celowo - idiom repo to „DROP IF EXISTS + CREATE" w jednym
 * pliku, więc kasowanie liczyłoby przepisania jako zniknięcia. O tym, czy
 * polityka nadal istnieje, rozstrzyga `extractLatestPolicies`.
 *
 * @param files migracje POSORTOWANE chronologicznie, z SQL bez komentarzy.
 */
export function extractPolicyHistory(
  files: readonly MigrationFile[],
): ReadonlyMap<string, readonly PolicyDef[]> {
  const history = new Map<string, PolicyDef[]>();
  for (const { file, sql } of files) {
    for (const event of collectEvents(file, sql)) {
      if (event.kind !== "create" || event.def === undefined) continue;
      const defs = history.get(event.key);
      if (defs === undefined) history.set(event.key, [event.def]);
      else defs.push(event.def);
    }
  }
  return history;
}

/** Czy polityka bramkuje INSERT (`FOR INSERT` albo `FOR ALL`). */
export function isInsertCapable(policy: PolicyDef): boolean {
  return policy.command === "all" || policy.command === "insert";
}

/**
 * Efektywny check INSERT-u: `WITH CHECK`, a gdy go brak (FOR ALL) - `USING`.
 * Brak obu klauzul nie ogranicza niczego, więc jest permisywny.
 */
export function insertCheckKind(policy: PolicyDef): "permissive" | "deny" | "restricted" {
  const fromCheck = classifyExpr(policy.withCheck);
  if (fromCheck !== "none") {
    return fromCheck === "true" ? "permissive" : fromCheck === "false" ? "deny" : "restricted";
  }
  const fromUsing = classifyExpr(policy.using);
  if (fromUsing === "true") return "permissive";
  if (fromUsing === "false") return "deny";
  if (fromUsing === "other") return "restricted";
  return "permissive";
}

/**
 * Pełny predykat polityki (USING + WITH CHECK) jako jeden tekst do analizy.
 * Klauzule są nawiasowane, żeby `a OR b` z jednej nie zlało się z drugą w
 * `a OR (b AND c)` - alternatywa wiąże słabiej niż koniunkcja.
 */
export function policyPredicate(policy: PolicyDef): string {
  return [policy.using, policy.withCheck]
    .filter((part) => part !== null)
    .map((part) => `(${part})`)
    .join(" AND ");
}
