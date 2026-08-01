import { describe, expect, it } from "vitest";
import {
  classifyProbe,
  contractFailed,
  extractExpectedContract,
  renderContractReport,
} from "../dbContract";

describe("extractExpectedContract", () => {
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
      { file: "0001.sql", sql: "CREATE TABLE public.old_table (id uuid); CREATE TABLE public.gone (id uuid);" },
      { file: "0002.sql", sql: "DROP TABLE IF EXISTS public.gone;" },
      { file: "0003.sql", sql: "ALTER TABLE public.old_table RENAME TO new_table;" },
    ]);
    expect(contract.tables.map((t) => t.name)).toEqual(["new_table"]);
  });

  it("ignoruje schematy zarządzane (auth/storage)", () => {
    const contract = extractExpectedContract([
      { file: "0001.sql", sql: "CREATE TABLE auth.sessions (id uuid); CREATE TABLE storage.objects (id uuid);" },
    ]);
    expect(contract.tables).toHaveLength(0);
  });
});

describe("classifyProbe", () => {
  it("traktuje PGRST205 / PGRST202 jako brak obiektu", () => {
    expect(classifyProbe(404, "PGRST205")).toBe("missing");
    expect(classifyProbe(404, "PGRST202")).toBe("missing");
  });

  it("brak uprawnień oznacza, że obiekt istnieje", () => {
    expect(classifyProbe(401, "42501")).toBe("present");
    expect(classifyProbe(403, null)).toBe("present");
    expect(classifyProbe(400, "PGRST203")).toBe("present");
  });

  it("2xx to obecność, gołe 404 nie rozstrzyga", () => {
    expect(classifyProbe(200, null)).toBe("present");
    expect(classifyProbe(404, null)).toBe("inconclusive");
  });
});

describe("raport kontraktu", () => {
  it("czerwony tylko przy brakujących obiektach", () => {
    expect(contractFailed({ checked: 3, missing: [], inconclusive: [] })).toBe(false);
    const failing = {
      checked: 3,
      missing: [{ kind: "table" as const, name: "posts", file: "0001.sql" }],
      inconclusive: [],
    };
    expect(contractFailed(failing)).toBe(true);
    expect(renderContractReport(failing)).toContain("table posts");
  });
});
