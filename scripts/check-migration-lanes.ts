/**
 * Bramka dwóch pasów migracji, w obu kierunkach.
 *
 * drizzle -> supabase: każdy wpis `drizzle/migrations/meta/_journal.json` ma
 * decyzję w `MIGRATION_LANES` (bliźniak w supabase/ albo powód, czemu go nie
 * ma) albo jest kopią pliku supabase o tym samym SQL-u wykonywalnym, a `when`
 * rośnie ściśle wzdłuż dziennika (inaczej migrator pominie wpis po cichu).
 *
 * supabase -> drizzle: każdy plik `supabase/migrations/` od startu pasa drizzle
 * ma kopię w dzienniku albo wpis w `SUPABASE_LANE_GAPS` - produkcja wykonuje
 * wyłącznie dziennik drizzle. Znane braki są drukowane przy każdym przebiegu.
 *
 * Cienki runner - rejestry, porównanie SQL-a i listy znanych przypadków żyją
 * w `src/lib/ci/migrationLaneParity.ts` i `src/lib/ci/supabaseLaneCoverage.ts`
 * (oba z testami jednostkowymi).
 *
 * Usage: bun run check:migration-lanes
 */
import { readFileSync } from "node:fs";
import {
  analyzeMigrationLanes,
  evaluateLaneGate,
  type JournalEntry,
  DRIZZLE_DIR,
  laneGateFailed,
  renderLaneGate,
} from "../src/lib/ci/migrationLaneParity";
import {
  analyzeSupabaseCoverage,
  renderSupabaseCoverage,
  supabaseCoverageFailed,
} from "../src/lib/ci/supabaseLaneCoverage";

function main(): void {
  const journal = JSON.parse(readFileSync(`${DRIZZLE_DIR}/meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  const tags = journal.entries.map((e) => e.tag);
  const report = analyzeMigrationLanes(tags);
  const result = evaluateLaneGate(report, journal.entries);
  console.log(renderLaneGate(report, result));
  const coverage = analyzeSupabaseCoverage(tags);
  console.log(renderSupabaseCoverage(coverage));
  if (laneGateFailed(result) || supabaseCoverageFailed(coverage)) process.exit(1);
}

main();
