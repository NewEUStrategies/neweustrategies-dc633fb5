import { describe, expect, it } from "vitest";
import {
  analyzeMigrationReplay,
  migrationReplayFailed,
  renderMigrationReplayReport,
  stripFunctionBodies,
} from "../migrationReplay";

describe("migration replay diagnostics", () => {
  it.each([
    "CREATE FUNCTION incomplete() RETURNS void AS 'SELECT 1' LANGUAGE sql;",
    "CREATE FUNCTION unfinished() RETURNS void AS $$ BEGIN;",
  ])(
    "preserves unsupported or unfinished function source for conservative inspection",
    (source) => {
      expect(stripFunctionBodies(source)).toBe(source);
    },
  );
  it("prints the exact signature and both files when CREATE repeats a function", () => {
    const files = ["20260101000000_first.sql", "20260101000001_second.sql"];
    const report = analyzeMigrationReplay(
      files,
      files.map((file) => ({
        file,
        sql: "CREATE FUNCTION public.demo() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      })),
      [],
    );
    expect(migrationReplayFailed(report)).toBe(true);
    const rendered = renderMigrationReplayReport(report);
    expect(rendered).toContain("demo");
    for (const file of files) expect(rendered).toContain(file);
    expect(rendered).toContain("42723");
  });
  it("prints ordering and stale-ledger diagnostics supplied by the replay analysis contract", () => {
    const report = {
      ...analyzeMigrationReplay([], [], []),
      outOfOrder: ["older.sql (before newer.sql)"],
      staleKnownTwins: ["first.sql|copy.sql"],
    };
    const rendered = renderMigrationReplayReport(report);
    expect(migrationReplayFailed(report)).toBe(true);
    expect(rendered).toContain("older.sql (before newer.sql)");
    expect(rendered).toContain("first.sql|copy.sql");
    expect(rendered).toContain("Usuń je z rejestru");
  });
});
