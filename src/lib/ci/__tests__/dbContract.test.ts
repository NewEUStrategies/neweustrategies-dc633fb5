import { describe, expect, it } from "vitest";
import { contractFailed, extractExpectedContract, renderContractReport } from "../dbContract";

describe("extractExpectedContract", () => {
  it("recreates an object dropped earlier in the same migration", () => {
    const result = extractExpectedContract([
      {
        file: "001.sql",
        sql: "CREATE TABLE public.items(id int); DROP TABLE public.items; CREATE TABLE public.items(id bigint);",
      },
    ]);
    expect(result.tables).toEqual([{ name: "items", kind: "table", file: "001.sql" }]);
  });
  it("ignores managed-schema drops and renames, including quoted empty names", () => {
    const result = extractExpectedContract([
      {
        file: "001.sql",
        sql: 'CREATE TABLE public.visible(id int); CREATE TABLE public.""(id int); DROP TABLE auth.visible; ALTER TABLE auth.users RENAME TO people; ALTER TABLE public.visible RENAME TO "";',
      },
    ]);
    expect(result.tables).toEqual([]);
  });
  it("zbiera tabele, widoki i funkcje ze schematu public", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: `CREATE TABLE public.posts (id uuid);
              CREATE VIEW public.posts_public AS SELECT 1;
              CREATE OR REPLACE FUNCTION public.has_role(a uuid, b app_role) RETURNS boolean AS $$ select true $$ LANGUAGE sql;`,
      },
    ]);
    expect(contract.tables.map((t) => t.name)).toEqual(["posts"]);
    expect(contract.views.map((v) => v.name)).toEqual(["posts_public"]);
    expect(contract.functions.map((f) => f.name)).toEqual(["has_role"]);
  });

  it("pomija funkcje wyzwalaczy (nie są wystawiane przez Data API)", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: `CREATE FUNCTION public.touch_updated_at() RETURNS trigger AS $$ begin return new; end $$ LANGUAGE plpgsql;`,
      },
    ]);
    expect(contract.functions).toHaveLength(0);
  });

  it("uwzględnia DROP i RENAME z późniejszych migracji", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: "CREATE TABLE public.old_table (id uuid); CREATE TABLE public.gone (id uuid);",
      },
      { file: "0002.sql", sql: "DROP TABLE IF EXISTS public.gone;" },
      { file: "0003.sql", sql: "ALTER TABLE public.old_table RENAME TO new_table;" },
    ]);
    expect(contract.tables.map((t) => t.name)).toEqual(["new_table"]);
  });

  it("ignoruje schematy zarządzane (auth/storage)", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: "CREATE TABLE auth.sessions (id uuid); CREATE TABLE storage.objects (id uuid);",
      },
    ]);
    expect(contract.tables).toHaveLength(0);
  });
});

describe("raport kontraktu", () => {
  it("distinguishes an inconclusive probe from a proven missing object", () => {
    const report = {
      checked: 1,
      missing: [],
      inconclusive: [{ kind: "view" as const, name: "public_feed", file: "001.sql" }],
    };
    expect(contractFailed(report)).toBe(true);
    expect(renderContractReport(report)).toContain("view public_feed");
    expect(renderContractReport(report)).toContain("Nierozstrzygnięte");
    expect(renderContractReport({ checked: 0, missing: [], inconclusive: [] })).not.toContain(
      "Brakujące obiekty",
    );
  });
  it("blocks missing objects and an empty contract", () => {
    expect(contractFailed({ checked: 3, missing: [], inconclusive: [] })).toBe(false);
    const failing = {
      checked: 3,
      missing: [{ kind: "table" as const, name: "posts", file: "0001.sql" }],
      inconclusive: [],
    };
    expect(contractFailed(failing)).toBe(true);
    expect(contractFailed({ checked: 0, missing: [], inconclusive: [] })).toBe(true);
    expect(renderContractReport(failing)).toContain("table posts");
  });
});
