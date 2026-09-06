import { describe, expect, it } from "vitest";
import {
  compareWithBaseline,
  findStaleColumns,
  freshnessFailed,
  readGeneratedColumns,
  renderFreshnessReport,
} from "../generatedTypesFreshness";

describe("generated schema measurements remain actionable after DDL changes", () => {
  it("moves only the renamed table's columns and drops only the removed table", () => {
    const migrations = [
      {
        file: "001.sql",
        sql: `
      ALTER TABLE public.before ADD COLUMN one text;
      ALTER TABLE public.other ADD COLUMN two text;
      ALTER TABLE public.before RENAME TO after;
      DROP TABLE public.other;
    `,
      },
    ];
    expect(
      findStaleColumns(
        migrations,
        new Map([
          ["after", new Set<string>()],
          ["other", new Set<string>()],
        ]),
      ),
    ).toEqual([{ table: "after", column: "one", file: "001.sql" }]);
  });
  it("ignores non-column type members when reading the generated row", () => {
    const types = `Tables: {\n      entries: {\n        Row: {\n          id: string\n          // comment\n\n        }\n      }\n    }`;
    expect(readGeneratedColumns(types).get("entries")).toEqual(new Set(["id"]));
  });
  it("prints a clean baseline, newly missing columns and resolved debt distinctly", () => {
    const clean = compareWithBaseline([], []);
    expect(freshnessFailed(clean)).toBe(false);
    expect(renderFreshnessReport(clean, 0)).toContain("OK");
    const fresh = compareWithBaseline(
      [{ table: "posts", column: "new_field", file: "001.sql" }],
      [],
    );
    expect(freshnessFailed(fresh)).toBe(true);
    expect(renderFreshnessReport(fresh, 0)).toContain("posts.new_field");
    expect(renderFreshnessReport(fresh, 0)).toContain("001.sql");
    const resolved = compareWithBaseline([], ["posts.old_field"]);
    expect(freshnessFailed(resolved)).toBe(true);
    expect(renderFreshnessReport(resolved, 1)).toContain("posts.old_field");
    expect(renderFreshnessReport(resolved, 1)).toContain("USUŃ");
  });
});
