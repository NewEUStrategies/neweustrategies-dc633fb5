/**
 * Bramka: widok DEFINER w public jest dla anon/authenticated TYLKO DO ODCZYTU -
 * w OBU pasach migracji (supabase/migrations i drizzle/migrations).
 *
 * Cienki runner - reguła, uzasadnienie i parser żyją w
 * `src/lib/ci/definerViewGrants.ts` (z testem jednostkowym), tak jak
 * `check-generated-types-freshness.ts` trzyma logikę w `src/lib/ci/`.
 *
 * Usage: bun run check:sql-definer-views
 *        bun run check:sql-definer-views --print-baseline   (podpowiedź wpisów rejestru)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeDefinerViews,
  KNOWN_DEFINER_VIEW_OFFENDERS,
  definerViewsFailed,
  renderDefinerViewReport,
  suggestKnownOffenders,
  type LaneFiles,
} from "../src/lib/ci/definerViewGrants";

function loadSupabase(): LaneFiles {
  const dir = "supabase/migrations";
  return {
    lane: "supabase",
    files: readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") })),
  };
}

/** Pas drizzle w kolejności `_journal.json` - sieroty spoza dziennika migrator pomija, więc i my. */
function loadDrizzle(): LaneFiles {
  const dir = "drizzle/migrations";
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  return {
    lane: "drizzle",
    files: journal.entries.map(({ tag }) => ({
      name: `${tag}.sql`,
      sql: readFileSync(join(dir, `${tag}.sql`), "utf8"),
    })),
  };
}

function main(): void {
  const lanes = [loadSupabase(), loadDrizzle()];
  const report = analyzeDefinerViews(lanes, KNOWN_DEFINER_VIEW_OFFENDERS);
  if (process.argv.includes("--print-baseline")) {
    for (const k of suggestKnownOffenders(report, lanes)) {
      console.log(
        `  { lane: "${k.lane}", file: "${k.file}", view: "${k.view}", closedBy: ${k.closedBy === null ? "null /* NIEDOMKNIĘTE - napraw migracją */" : `"${k.closedBy}"`} },`,
      );
    }
    return;
  }
  console.log(renderDefinerViewReport(report));
  if (definerViewsFailed(report)) process.exit(1);
}

main();
