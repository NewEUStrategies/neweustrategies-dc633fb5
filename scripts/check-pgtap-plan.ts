/**
 * Bramka inwariantu: `plan(N)` W PLIKACH pgTAP ZGADZA SIĘ Z LICZBĄ ASERCJI.
 *
 * Cienki runner - cała logika (i jej uzasadnienie: rozjazd planu jest widoczny
 * dopiero z prawdziwego Postgresa, a gdy job `pgtap` pada z innego powodu, zostaje
 * niewidoczny) żyje w `src/lib/ci/pgTapPlan.ts`, tak jak
 * `check-sql-migration-replay.ts` trzyma swoją w `src/lib/ci/migrationReplay.ts`.
 * Dzięki temu inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/pgTapPlan.test.ts`), a nie tylko przebieg w CI.
 *
 * Usage: bun run scripts/check-pgtap-plan.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzePgTapPlans, pgTapPlanFailed, renderPgTapPlanReport } from "../src/lib/ci/pgTapPlan";
import { PGTAP_TESTS_DIR } from "./lib/pgTapTests";

function main(): void {
  const sources = readdirSync(PGTAP_TESTS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(PGTAP_TESTS_DIR, file), "utf8") }));

  const report = analyzePgTapPlans(sources);
  console.log(renderPgTapPlanReport(report));
  if (pgTapPlanFailed(report)) process.exit(1);
}

main();
