/**
 * Bramka dwóch pasów migracji: oba kierunki i lustro.
 *
 * drizzle -> supabase: wpis `drizzle/migrations/meta/_journal.json` do
 * JOURNAL_FREEZE_IDX ma decyzję w `MIGRATION_LANES` (bliźniak w supabase/ albo
 * powód, czemu go nie ma) albo jest kopią pliku supabase o tym samym SQL-u
 * wykonywalnym; po nim decyduje wyłącznie treść (lustro, kopia, wyzwalacz
 * wdrożenia, znacznik z samych COMMENT ON). `when` rośnie ściśle wzdłuż
 * dziennika (inaczej migrator pominie wpis po cichu).
 *
 * supabase -> drizzle: każdy plik `supabase/migrations/` od startu pasa drizzle
 * ma lustro w dzienniku (`bun run migrations:mirror`) albo wpis w `SUPABASE_LANE_GAPS` -
 * produkcja dostaje schemat wyłącznie migratorem Drizzle uruchamianym narzędziem Lovable.
 * Pliki zastosowane poza dziennikiem są drukowane przy każdym przebiegu.
 *
 * lustro: dziennik drizzle = wynik generatora - `bun run migrations:mirror`
 * nie zmieniłby ani jednego pliku (bez bazy, jak `--check`: wynik zależy
 * wyłącznie od drzewa).
 *
 * Cienki runner - rejestry, porównanie SQL-a, listy znanych przypadków i plan
 * lustra żyją w `src/lib/ci/migrationLaneParity.ts`,
 * `src/lib/ci/supabaseLaneCoverage.ts` i `src/lib/migrations/drizzleMirror.ts`
 * (wszystkie z testami jednostkowymi).
 *
 * Usage: bun run check:migration-lanes
 */
import {
  analyzeMigrationLanes,
  evaluateLaneGate,
  laneGateFailed,
  renderLaneGate,
} from "../src/lib/ci/migrationLaneParity";
import {
  analyzeSupabaseCoverage,
  renderSupabaseCoverage,
  supabaseCoverageFailed,
} from "../src/lib/ci/supabaseLaneCoverage";
import { mirrorFresh, planMirror, renderMirrorPlan } from "../src/lib/migrations/drizzleMirror";
import { loadMirrorInput } from "../src/lib/migrations/drizzleMirrorCli";
import { nodeMirrorFs } from "./lib/drizzleMirrorDisk";

function main(): void {
  const input = loadMirrorInput(nodeMirrorFs);
  if ("error" in input) {
    console.log(`✗ ${input.error}`);
    process.exit(1);
  }
  const entries = input.journal.entries;
  const tags = entries.map((e) => e.tag);
  const report = analyzeMigrationLanes(tags);
  const result = evaluateLaneGate(report, entries);
  console.log(renderLaneGate(report, result));
  const coverage = analyzeSupabaseCoverage(tags);
  console.log(renderSupabaseCoverage(coverage));
  const plan = planMirror({ ...input, now: Date.now() });
  console.log(renderMirrorPlan(plan, "check"));
  if (laneGateFailed(result) || supabaseCoverageFailed(coverage) || !mirrorFresh(plan))
    process.exit(1);
}

main();
