/**
 * Bramka dwóch pasów migracji: każdy wpis `drizzle/migrations/meta/_journal.json`
 * ma decyzję w `MIGRATION_LANES` (bliźniak w supabase/ albo powód, czemu go nie
 * ma) albo jest kopią pliku supabase o tym samym SQL-u wykonywalnym, a `when`
 * rośnie ściśle wzdłuż dziennika (inaczej migrator pominie wpis po cichu).
 *
 * Cienki runner - rejestr, porównanie SQL-a i lista znanych sierot żyją
 * w `src/lib/ci/migrationLaneParity.ts` (z testem jednostkowym).
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

function main(): void {
  const journal = JSON.parse(readFileSync(`${DRIZZLE_DIR}/meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  const report = analyzeMigrationLanes(journal.entries.map((e) => e.tag));
  const result = evaluateLaneGate(report, journal.entries);
  console.log(renderLaneGate(report, result));
  if (laneGateFailed(result)) process.exit(1);
}

main();
