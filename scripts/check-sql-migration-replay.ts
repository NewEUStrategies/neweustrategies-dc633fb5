/**
 * Bramka inwariantu: BAZĘ MUSI DAĆ SIĘ ODTWORZYĆ Z MIGRACJI.
 *
 * Cienki runner - cała logika (i jej uzasadnienie: kolizje wersji + wykonywane
 * zapisy do `storage.objects` bez sankcjonowanej furtki) żyje w
 * `src/lib/ci/migrationReplay.ts`, tak jak `check-db-contract.ts` trzyma swoją
 * w `src/lib/ci/dbContract.ts`. Dzięki temu inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/migrationReplay.test.ts`), a nie tylko przebieg w CI.
 *
 * Usage: bun run scripts/check-sql-migration-replay.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeMigrationReplay,
  migrationReplayFailed,
  renderMigrationReplayReport,
} from "../src/lib/ci/migrationReplay";
import { MIGRATIONS_DIR } from "./lib/sqlMigrations";

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const sources = files.map((file) => ({
    file,
    sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
  }));
  const report = analyzeMigrationReplay(files, sources);
  console.log(renderMigrationReplayReport(report));
  if (migrationReplayFailed(report)) process.exit(1);
}

main();
