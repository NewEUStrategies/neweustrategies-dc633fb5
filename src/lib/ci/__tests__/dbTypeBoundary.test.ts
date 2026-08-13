// Testy jednostkowe dwóch bramek granicy typów bazy. Konwencja repo: inwariant
// CI ma test, a nie tylko przebieg w CI - inaczej sam skaner nie ma jak umrzeć
// na czerwono, gdy przestanie cokolwiek widzieć.
import { describe, expect, it } from "vitest";
import {
  isDerivedFromGenerated,
  isScannable,
  scanHandWrittenRowCasts,
  staleExceptions,
} from "@/lib/ci/dbRowCasts";
import {
  compareWithBaseline,
  findStaleColumns,
  freshnessFailed,
  readGeneratedColumns,
  scanColumnEvents,
} from "@/lib/ci/generatedTypesFreshness";

const TYPES = `
      payment_orders: {
        Row: {
          amount_cents: number
          id: string
          status: string
        }
        Insert: {
          id?: string
        }
      }
      profiles: {
        Row: {
          id: string
          email: string | null
        }
        Insert: {
          id?: string
        }
      }
`;

describe("dbRowCasts - rzutowanie wyniku zapytania", () => {
  it("zgłasza cast na typ napisany ręcznie w tym samym pliku", () => {
    const source = [
      "interface OrderRow { id: string }",
      'const { data } = await supabase.from("payment_orders").select("id");',
      "const rows = (data ?? []) as unknown as OrderRow[];",
    ].join("\n");
    const hits = scanHandWrittenRowCasts([{ file: "a.ts", source }], []);
    expect(hits.map((h) => h.type)).toEqual(["OrderRow"]);
    expect(hits[0].line).toBe(3);
  });

  it("NIE zgłasza typu wyprowadzonego z generowanych", () => {
    const source = [
      'type OrderRow = Pick<Tables<"payment_orders">, "id">;',
      'const { data } = await supabase.from("payment_orders").select("id");',
      "const rows = (data ?? []) as unknown as OrderRow[];",
    ].join("\n");
    expect(scanHandWrittenRowCasts([{ file: "a.ts", source }], [])).toEqual([]);
  });

  it("NIE zgłasza typu zaimportowanego - to inna klasa i inna bramka", () => {
    const source = [
      'import type { OrderRow } from "@/lib/billing/model";',
      'const { data } = await supabase.from("payment_orders").select("id");',
      "const rows = (data ?? []) as unknown as OrderRow[];",
    ].join("\n");
    expect(scanHandWrittenRowCasts([{ file: "a.ts", source }], [])).toEqual([]);
  });

  it("NIE zgłasza pliku bez zapytania - bez zapytania nie ma granicy bazy", () => {
    const source = ["interface Shape { id: string }", "const rows = data as unknown as Shape[];"].join(
      "\n",
    );
    expect(scanHandWrittenRowCasts([{ file: "a.ts", source }], [])).toEqual([]);
  });

  it("wyjątek wycisza dokładnie jedną parę plik::typ", () => {
    const source = [
      "interface OrderRow { id: string }",
      'const { data } = await supabase.from("payment_orders").select("id");',
      "const rows = (data ?? []) as unknown as OrderRow[];",
    ].join("\n");
    const exceptions = [{ file: "a.ts", type: "OrderRow", reason: "rpc" }];
    expect(scanHandWrittenRowCasts([{ file: "a.ts", source }], exceptions)).toEqual([]);
    // Ten sam typ w INNYM pliku nadal oblewa - wyjątek nie jest globalny.
    expect(scanHandWrittenRowCasts([{ file: "b.ts", source }], exceptions)).toHaveLength(1);
  });

  it("wykrywa wyjątek, który przestał być potrzebny", () => {
    const derived = 'type OrderRow = Pick<Tables<"payment_orders">, "id">;\nas unknown as OrderRow';
    const stale = staleExceptions(
      [{ file: "a.ts", source: derived }],
      [{ file: "a.ts", type: "OrderRow", reason: "join" }],
    );
    expect(stale.map((entry) => entry.type)).toEqual(["OrderRow"]);
  });

  it("`interface X extends Pick<Tables<…>>` liczy się jako wyprowadzony", () => {
    expect(
      isDerivedFromGenerated('interface Row extends Pick<Tables<"profiles">, "id"> {}', "Row"),
    ).toBe(true);
    expect(isDerivedFromGenerated("interface Row { id: string }", "Row")).toBe(false);
  });

  it("pliki testowe i wygenerowane typy są poza skanem", () => {
    expect(isScannable("src/lib/a.ts")).toBe(true);
    expect(isScannable("src/lib/__tests__/a.ts")).toBe(false);
    expect(isScannable("src/lib/a.test.ts")).toBe(false);
    expect(isScannable("src/integrations/supabase/types.ts")).toBe(false);
  });
});

describe("generatedTypesFreshness - typy vs migracje", () => {
  it("czyta kolumny bloku Row, a nie Insert", () => {
    const columns = readGeneratedColumns(TYPES);
    expect([...(columns.get("payment_orders") ?? [])].sort()).toEqual([
      "amount_cents",
      "id",
      "status",
    ]);
    expect(columns.size).toBe(2);
  });

  it("kolumna dodana migracją i nieobecna w typach jest długiem", () => {
    const stale = findStaleColumns(
      [{ file: "001.sql", sql: "ALTER TABLE public.profiles ADD COLUMN nowa text;" }],
      readGeneratedColumns(TYPES),
    );
    expect(stale.map((entry) => `${entry.table}.${entry.column}`)).toEqual(["profiles.nowa"]);
  });

  it("kolumna dodana i później skreślona NIE jest długiem", () => {
    const stale = findStaleColumns(
      [
        { file: "001.sql", sql: "ALTER TABLE public.profiles ADD COLUMN nowa text;" },
        { file: "002.sql", sql: "ALTER TABLE public.profiles DROP COLUMN nowa;" },
      ],
      readGeneratedColumns(TYPES),
    );
    expect(stale).toEqual([]);
  });

  it("tabela nieznana typom jest pomijana - nowa tabela nie skompiluje się i tak", () => {
    const stale = findStaleColumns(
      [{ file: "001.sql", sql: "ALTER TABLE public.calkiem_nowa ADD COLUMN x text;" }],
      readGeneratedColumns(TYPES),
    );
    expect(stale).toEqual([]);
  });

  it("zakomentowany ADD COLUMN się nie liczy", () => {
    const events = scanColumnEvents([
      { file: "001.sql", sql: "-- ALTER TABLE public.profiles ADD COLUMN nowa text;\n" },
    ]);
    expect(events).toEqual([]);
  });

  it("baseline wycisza znany dług, ale nie nowy", () => {
    const stale = findStaleColumns(
      [
        { file: "001.sql", sql: "ALTER TABLE public.profiles ADD COLUMN znana text;" },
        { file: "002.sql", sql: "ALTER TABLE public.profiles ADD COLUMN nowa text;" },
      ],
      readGeneratedColumns(TYPES),
    );
    const report = compareWithBaseline(stale, ["profiles.znana"]);
    expect(report.fresh.map((entry) => entry.column)).toEqual(["nowa"]);
    expect(freshnessFailed(report)).toBe(true);
  });

  it("wpis baseline'u bez odpowiadającego długu oblewa - lista ma maleć", () => {
    const report = compareWithBaseline([], ["profiles.juz_nieaktualna"]);
    expect(report.resolved).toEqual(["profiles.juz_nieaktualna"]);
    expect(freshnessFailed(report)).toBe(true);
  });
});
