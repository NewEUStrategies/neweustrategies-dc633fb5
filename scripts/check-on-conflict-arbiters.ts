/**
 * Bramka kontraktowa: KAŻDY CEL `onConflict` W `.upsert(...)` MA ARBITRA
 * w schemacie odtworzonym z migracji.
 *
 * Cienki runner - model kluczy unikalnych, ekstrakcja celów z kodu, polityka
 * bloków DO i uzasadnienie żyją w `src/lib/ci/onConflictArbiters.ts`, więc
 * inwariant ma test jednostkowy (`src/lib/ci/__tests__/onConflictArbiters.test.ts`),
 * a nie tylko przebieg w CI.
 *
 * Po co: `ON CONFLICT (kolumny)` bez klucza o dokładnie tym zbiorze kolumn to
 * 42P10 przy KAŻDYM wywołaniu - a atrapa bazy w testach przyjmuje każdy cel.
 * Tak przez wiele wydań nie działała żadna wysyłka zaproszenia
 * (`user_roles`: `user_id,role` po zamianie klucza na `tenant_id,user_id,role`).
 *
 * Czyta wyłącznie pliki repo (migracje + `src/**`), bez bazy i bez buildu.
 *
 * Usage: bun run check:on-conflict-arbiters
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  analyzeOnConflictArbiters,
  onConflictArbitersFailed,
  renderOnConflictArbitersReport,
  type SourceFile,
} from "../src/lib/ci/onConflictArbiters";
import { loadMigrationFiles } from "./lib/sqlMigrations";

const SOURCE_ROOT = "src";
const SOURCE_EXT = /\.(?:ts|tsx)$/;
/**
 * Testy, atrapy i fixture'y cytują cele konfliktu celowo (także błędne, żeby
 * dowieść, że bramka je łapie) - skan po nich zapalałby bramkę na jej własnej
 * dokumentacji. Zakres jak w `scripts/check-feature-taxonomy.ts`.
 */
const SKIP_DIRS = new Set(["node_modules", "__tests__", "__snapshots__", "__mocks__"]);
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function loadSources(): SourceFile[] {
  return walk(SOURCE_ROOT, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter((file) => SOURCE_EXT.test(file) && !TEST_FILE.test(file))
    .filter((file) => !file.startsWith("src/test/"))
    .sort()
    .map((file) => ({ file, code: readFileSync(file, "utf8") }));
}

function main(): void {
  const started = Date.now();
  const report = analyzeOnConflictArbiters({
    migrations: loadMigrationFiles(),
    sources: loadSources(),
  });
  const rendered = renderOnConflictArbitersReport(report);
  const elapsed = `  (${((Date.now() - started) / 1000).toFixed(2)} s)`;

  if (onConflictArbitersFailed(report)) {
    console.error(rendered + elapsed);
    process.exit(1);
  }
  console.log(rendered + elapsed);
}

main();
