// Stanowe tabele PostgREST na wspólnej atrapie łańcucha (`@/test/supabase/chain`).
//
// PO CO. Testy przepływów pieniędzy „od zdarzenia operatora do dostępu"
// (spór otwarty -> wygrany, zwrot -> spóźniona realizacja) sprawdzają STAN po
// kilku zdarzeniach z rzędu. Odpowiedzi planowane per zapytanie
// (`setResponse`) nie mają pamięci: drugie zdarzenie nie widziałoby, co
// zapisało pierwsze, więc test dowodziłby kolejności wywołań, a nie skutku.
// Tutaj każdy zapis zmienia wiersze, a kolejny odczyt je widzi.
//
// ZAKRES ŚWIADOMIE WĄSKI - tyle PostgREST, ile czytają moduły rozliczeń:
// filtry `eq` / `neq` / `in` / `is` / `or` (lista `kolumna.eq.wartość`),
// zapisy `insert` / `update` / `upsert` (z `onConflict`) / `delete`, odczyt
// listą, `maybeSingle` i `single`. Ogniwo filtrujące spoza tej listy RZUCA -
// cicho zignorowany filtr oznaczałby zapis „we wszystkie wiersze" i test,
// który przechodzi z niewłaściwego powodu.
//
// Semantyka NULL jak w SQL: `neq` i `in` nie dopasowują wiersza z NULL.
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedCall,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase/chain";

export type Row = Record<string, unknown>;

export interface MemoryTables {
  /** Atrapa do wstrzyknięcia w `supabaseAdmin.from`. */
  readonly stub: SupabaseFromStub;
  /** Żywe wiersze tabeli (ta sama tablica, którą zmieniają zapisy). */
  rows(table: string): Row[];
  /** Pierwszy wiersz spełniający warunek - skrót do asercji. */
  find(table: string, predicate: (row: Row) => boolean): Row | undefined;
  /** Wymuszony błąd kolejnych zapytań do tabeli (awaria bazy). */
  failTable(table: string, message: string | null): void;
}

const IGNORED = new Set(["select", "order", "limit", "range", "returns", "abortSignal"]);
const WRITES = new Set(["insert", "update", "upsert", "delete"]);

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function matchesOr(row: Row, expression: string): boolean {
  return expression.split(",").some((part) => {
    const [column, op, ...rest] = part.split(".");
    if (op !== "eq" || !column) throw new Error(`memoryTables: nieobsłużony warunek or(${part})`);
    return String(row[column]) === rest.join(".");
  });
}

function matches(row: Row, call: RecordedCall): boolean {
  const [column, value] = call.args as [string, unknown];
  switch (call.method) {
    case "eq":
      return row[column] === value;
    case "neq":
      return !isNullish(row[column]) && row[column] !== value;
    case "in":
      return !isNullish(row[column]) && (value as unknown[]).includes(row[column]);
    case "is":
      return value === null ? isNullish(row[column]) : row[column] === value;
    case "or":
      return matchesOr(row, String(column));
    default:
      throw new Error(`memoryTables: nieobsłużone ogniwo .${call.method}()`);
  }
}

let sequence = 0;

/** Tabele w pamięci dla podanych nazw; tabela spoza listy to błąd testu. */
export function memoryTables(seed: Record<string, Row[]>): MemoryTables {
  const stub = supabaseFromStub();
  const tables = new Map<string, Row[]>();
  const failures = new Map<string, string>();

  const respond = (table: string, chain: RecordedChain): SupabaseResult => {
    const failure = failures.get(table);
    if (failure) return fail(failure);
    const rows = tables.get(table) ?? [];
    const write = chain.calls.find((call) => WRITES.has(call.method));
    const filters = chain.calls.filter(
      (call) =>
        !IGNORED.has(call.method) &&
        !WRITES.has(call.method) &&
        call.method !== "maybeSingle" &&
        call.method !== "single",
    );
    const matched = () => rows.filter((row) => filters.every((call) => matches(row, call)));
    const returning = chain.has("select");

    if (write?.method === "insert" || write?.method === "upsert") {
      const payload = write.args[0];
      const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const conflict =
        write.method === "upsert"
          ? String((write.args[1] as { onConflict?: string } | undefined)?.onConflict ?? "id")
              .split(",")
              .map((key) => key.trim())
          : null;
      const written: Row[] = [];
      for (const next of incoming) {
        const existing = conflict
          ? rows.find((row) => conflict.every((key) => row[key] === next[key]))
          : undefined;
        if (existing) {
          Object.assign(existing, next);
          written.push(existing);
        } else {
          const row = { id: `${table}-${++sequence}`, ...next };
          rows.push(row);
          written.push(row);
        }
      }
      return ok(returning ? written : null);
    }
    if (write?.method === "update") {
      const hits = matched();
      for (const row of hits) Object.assign(row, write.args[0] as Row);
      return ok(returning ? hits.map((row) => ({ ...row })) : null);
    }
    if (write?.method === "delete") {
      const hits = matched();
      tables.set(
        table,
        rows.filter((row) => !hits.includes(row)),
      );
      return ok(returning ? hits : null);
    }

    const hits = matched().map((row) => ({ ...row }));
    if (chain.has("maybeSingle")) return ok(hits[0] ?? null);
    if (chain.has("single")) return hits[0] ? ok(hits[0]) : fail("memoryTables: brak wiersza");
    const limit = chain.argsOf("limit")?.[0];
    return ok(typeof limit === "number" ? hits.slice(0, limit) : hits);
  };

  for (const [table, rows] of Object.entries(seed)) {
    tables.set(
      table,
      rows.map((row) => ({ ...row })),
    );
    stub.setResponse(table, (chain) => respond(table, chain));
  }

  return {
    stub,
    rows: (table) => tables.get(table) ?? [],
    find: (table, predicate) => (tables.get(table) ?? []).find(predicate),
    failTable: (table, message) => {
      if (message === null) failures.delete(table);
      else failures.set(table, message);
    },
  };
}
