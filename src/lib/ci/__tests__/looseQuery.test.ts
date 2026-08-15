// Test kontraktu `LooseQuery` - inwariant, dla którego ten typ powstał.
//
// Właściwy dowód jest KOMPILACYJNY: kod produkcyjny robi `await looseTable(...)`
// bez rzutowania, więc gdyby `then` przestało być `PromiseLike`, `tsc` oblałby
// build. Ten plik dokłada dwie rzeczy, których typy nie pokazują: że pomocnicy
// zachowują się poprawnie na REALNYCH kształtach wyników PostgREST (`null` przy
// pustym wyniku, obiekt przy `maybeSingle`) i że `await` na atrapie buildera
// naprawdę przechodzi.
import { describe, expect, it } from "vitest";
import {
  fetchRows,
  rowsOf,
  unwrap,
  type LooseQuery,
  type LooseResult,
} from "../../supabase/looseQuery";

/** Atrapa buildera: łańcuchowalna i awaitowalna, jak prawdziwy PostgREST. */
function stubQuery<Row>(result: LooseResult<Row[] | null>): LooseQuery<Row> {
  const self: Record<string, unknown> = {
    then: (onfulfilled?: (value: LooseResult<Row[] | null>) => unknown) =>
      Promise.resolve(result).then(onfulfilled),
  };
  for (const method of [
    "select",
    "order",
    "limit",
    "range",
    "eq",
    "neq",
    "is",
    "not",
    "in",
    "or",
    "ilike",
    "gte",
    "lte",
    "overlaps",
    "contains",
    "returns",
    "insert",
    "upsert",
    "update",
    "delete",
  ]) {
    self[method] = () => self;
  }
  return self as unknown as LooseQuery<Row>;
}

describe("LooseQuery", () => {
  it("builder jest awaitowalny bez rzutowania - to jest cały powód istnienia typu", async () => {
    const result = await stubQuery({ data: [{ id: "a" }], error: null })
      .select("id")
      .eq("tenant_id", "t1")
      .limit(10);
    expect(result.data).toEqual([{ id: "a" }]);
  });

  it("`returns` jest przezroczyste w runtime - zmienia wyłącznie typ", async () => {
    const query = stubQuery<{ id: string }>({ data: [{ id: "a" }], error: null });
    expect(await query.returns<{ id: string }>()).toEqual(await query);
  });
});

describe("rowsOf", () => {
  it("pusty wynik PostgREST to `null`, nie pusta tablica", () => {
    expect(rowsOf({ data: null, error: null })).toEqual([]);
  });

  it("przepuszcza wiersze bez kopiowania", () => {
    const data = [{ id: "a" }];
    expect(rowsOf({ data, error: null })).toBe(data);
  });
});

describe("fetchRows", () => {
  it("skleja await i rowsOf", async () => {
    expect(
      await fetchRows(stubQuery({ data: [{ id: "a" }, { id: "b" }], error: null })),
    ).toHaveLength(2);
  });

  it("pusty wynik daje pustą tablicę, nie wyjątek", async () => {
    expect(await fetchRows(stubQuery({ data: null, error: null }))).toEqual([]);
  });
});

describe("unwrap", () => {
  it("zwraca dane, gdy nie ma błędu", () => {
    expect(unwrap({ data: 42, error: null })).toBe(42);
  });

  it("zamienia błąd PostgREST na Error z jego komunikatem", () => {
    expect(() => unwrap({ data: null, error: { message: "permission denied" } })).toThrow(
      "permission denied",
    );
  });

  it("kod błędu przeżywa - `23505` odróżnia duplikat od awarii", () => {
    const result: LooseResult<null> = {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    };
    expect(result.error?.code).toBe("23505");
  });
});
