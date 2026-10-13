// Tabela w pamięci za atrapą `supabase.from(...)` - dla testów, które muszą
// dowieść ZACHOWANIA zapisu warunkowego, a nie tylko kształtu zapytania.
//
// DLACZEGO OSOBNO OD `@/test/supabase/chain`. Tamta atrapa odpowiada tym, co
// test zaplanował, niezależnie od filtrów - wystarcza, gdy pytanie brzmi
// „jakie zapytanie poszło". Strażnik kolejności zdarzeń subskrypcji i
// unikalność uprawnień stoją jednak na SEMANTYCE: warunkowy UPDATE zajmuje
// wiersz tylko przy starszym znaczniku, wstawienie przegrywa wyścig kodem
// 23505, `ON CONFLICT DO NOTHING` nie zwraca wiersza. Test ponowienia po
// porażce albo dwóch równoległych zdarzeń musi widzieć, jak stan tabeli
// zmienia się między wywołaniami - inaczej dowodzi tylko własnego scenariusza.
//
// Zakres jest CELOWO wąski: filtry `eq`, `neq`, `is`, `lt`, `lte`, `gt`,
// `gte` i `or(...)` złożone z nich, `insert`, `upsert` (z `onConflict`
// i `ignoreDuplicates`), `update`, `select`, `maybeSingle`. Nieznane ogniwo
// filtrujące to błąd testu, a nie cicho pominięty warunek.
import { fail, ok, type RecordedChain, type SupabaseResult } from "@/test/supabase/chain";

export type StoredRow = Record<string, unknown>;

export interface RowStoreOptions {
  /** Wiersze startowe (kopiowane - test nie zmienia własnych literałów). */
  rows?: StoredRow[];
  /** Kolumny z indeksem unikalnym; konflikt = 23505 (jak w Postgresie). */
  unique?: readonly string[];
  /** Kolumny `timestamptz` - porównywane jako chwile, nie jako napisy. */
  timestamps?: readonly string[];
  /**
   * Punkt zaczepienia PRZED rozstrzygnięciem łańcucha - test wymusza nim
   * przeplot dwóch równoległych obsług (np. obie czytają „brak wiersza",
   * zanim którakolwiek cokolwiek zapisze).
   */
  beforeResolve?: (chain: RecordedChain) => Promise<void> | void;
}

export interface RowStore {
  readonly rows: StoredRow[];
  respond(chain: RecordedChain): Promise<SupabaseResult>;
}

const FILTERS: ReadonlySet<string> = new Set(["eq", "neq", "is", "lt", "lte", "gt", "gte", "or"]);
const SHAPERS: ReadonlySet<string> = new Set([
  "select",
  "insert",
  "upsert",
  "update",
  "maybeSingle",
  "single",
  "order",
  "limit",
]);

export function rowStore(options: RowStoreOptions = {}): RowStore {
  const rows: StoredRow[] = (options.rows ?? []).map((row) => ({ ...row }));
  const timestamps = new Set(options.timestamps ?? []);
  const unique = options.unique ?? [];
  let nextId = rows.length + 1;

  const norm = (column: string, value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    if (timestamps.has(column) && typeof value === "string") return Date.parse(value);
    return value;
  };

  const compare = (op: string, column: string, actual: unknown, expected: unknown): boolean => {
    const a = norm(column, actual);
    const b = op === "is" && expected === "null" ? null : norm(column, expected);
    switch (op) {
      case "eq":
        return a !== null && a === b;
      case "neq":
        return a !== null && a !== b;
      case "is":
        return a === b;
      case "lt":
        return a !== null && b !== null && (a as number) < (b as number);
      case "lte":
        return a !== null && b !== null && (a as number) <= (b as number);
      case "gt":
        return a !== null && b !== null && (a as number) > (b as number);
      case "gte":
        return a !== null && b !== null && (a as number) >= (b as number);
      default:
        throw new Error(`rowStore: nieobsługiwany operator "${op}"`);
    }
  };

  /** `or("kolumna.op.wartość,kolumna.op.wartość")` - składnia PostgREST. */
  const matchesOr = (row: StoredRow, expression: string): boolean =>
    expression.split(",").some((part) => {
      const first = part.indexOf(".");
      const second = part.indexOf(".", first + 1);
      const column = part.slice(0, first);
      const op = part.slice(first + 1, second);
      const value = part.slice(second + 1);
      return compare(op, column, row[column], value);
    });

  const matches = (row: StoredRow, chain: RecordedChain): boolean =>
    chain.calls.every((call) => {
      if (!FILTERS.has(call.method)) {
        if (SHAPERS.has(call.method)) return true;
        throw new Error(`rowStore: nieobsługiwane ogniwo "${call.method}"`);
      }
      if (call.method === "or") return matchesOr(row, String(call.args[0]));
      return compare(call.method, String(call.args[0]), row[String(call.args[0])], call.args[1]);
    });

  const conflictOf = (candidate: StoredRow, columns: readonly string[]): StoredRow | undefined =>
    rows.find((row) =>
      columns.every(
        (column) =>
          candidate[column] !== null &&
          candidate[column] !== undefined &&
          norm(column, row[column]) === norm(column, candidate[column]),
      ),
    );

  const selected = (chain: RecordedChain, hit: StoredRow[]): SupabaseResult => {
    if (!chain.has("select")) return ok(null);
    return ok(hit.map((row) => ({ ...row })));
  };

  async function respond(chain: RecordedChain): Promise<SupabaseResult> {
    await options.beforeResolve?.(chain);

    if (chain.has("insert") || chain.has("upsert")) {
      const method = chain.has("insert") ? "insert" : "upsert";
      const payload = chain.argsOf(method)?.[0] as StoredRow;
      const upsertOptions = (chain.argsOf("upsert")?.[1] ?? {}) as {
        onConflict?: string;
        ignoreDuplicates?: boolean;
      };
      const target = upsertOptions.onConflict?.split(",").map((c) => c.trim());
      if (method === "upsert" && target) {
        const existing = conflictOf(payload, target);
        if (existing) {
          if (upsertOptions.ignoreDuplicates) return selected(chain, []);
          Object.assign(existing, payload);
          return selected(chain, [existing]);
        }
      }
      for (const column of unique) {
        if (conflictOf(payload, [column])) {
          return fail(`duplicate key value violates unique constraint (${column})`, "23505");
        }
      }
      const row: StoredRow = { id: `row-${nextId}`, ...payload };
      nextId += 1;
      rows.push(row);
      return selected(chain, [row]);
    }

    if (chain.has("update")) {
      const patch = chain.argsOf("update")?.[0] as StoredRow;
      const hit = rows.filter((row) => matches(row, chain));
      for (const row of hit) Object.assign(row, patch);
      return selected(chain, hit);
    }

    const hit = rows.filter((row) => matches(row, chain));
    if (chain.has("maybeSingle") || chain.has("single")) {
      if (hit.length > 1) return fail("JSON object requested, multiple rows returned", "PGRST116");
      return ok(hit[0] ? { ...hit[0] } : null);
    }
    return ok(hit.map((row) => ({ ...row })));
  }

  return { rows, respond };
}
