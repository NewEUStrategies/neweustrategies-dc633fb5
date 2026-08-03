/**
 * Bramka inwariantu: KAŻDA MIGRACJA MA UNIKALNĄ WERSJĘ.
 *
 * Cienki runner - cała logika (i jej uzasadnienie) żyje w
 * `src/lib/ci/migrationVersions.ts`, tak jak `check-db-contract.ts` trzyma swoją
 * w `src/lib/ci/dbContract.ts`. Dzięki temu inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/migrationVersions.test.ts`), a nie tylko przebieg w CI.
 *
 * Usage: bun run scripts/check-sql-migration-versions.ts
 */
import { readdirSync } from "node:fs";
import {
  analyzeMigrationVersions,
  migrationVersionsFailed,
  renderMigrationVersionReport,
} from "../src/lib/ci/migrationVersions";
import { MIGRATIONS_DIR } from "./lib/sqlMigrations";

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const report = analyzeMigrationVersions(files);
  console.log(renderMigrationVersionReport(report));
  if (migrationVersionsFailed(report)) process.exit(1);
}

main();
