/**
 * Bramka własnicielska: każda trasa administracyjna i każda migracja bazy ma
 * wskazanego właściciela technicznego, a dokumenty utrzymaniowe istnieją i nie
 * wygasły.
 *
 * Cienki runner - inwariant, uzasadnienie i cała logika żyją w
 * `src/lib/ci/ownership.ts` (konwencja jak `check-gate-coverage.ts`). Dzięki
 * temu bramka ma test jednostkowy (`src/lib/ci/__tests__/ownership.test.ts`),
 * a nie tylko przebieg w CI.
 *
 * Rejestr: `governance/ownership.json`. Instrukcja edycji: `governance/README.md`.
 *
 * Usage: bun run check:ownership
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeOwnership,
  ownershipFailed,
  parseRegistry,
  renderOwnershipReport,
  type MigrationSource,
} from "../src/lib/ci/ownership";

const REGISTRY_PATH = "governance/ownership.json";
const ROUTES_DIR = "src/routes";
const MIGRATIONS_DIR = "supabase/migrations";

/** Trasy panelu to pliki `admin*.tsx` w płaskim katalogu tras (routing plikowy). */
function readRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((file) => file.startsWith("admin") && file.endsWith(".tsx"))
    .sort();
}

function readMigrations(): MigrationSource[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

function main(): void {
  const registry = parseRegistry(JSON.parse(readFileSync(REGISTRY_PATH, "utf8")));

  // Dokumenty, których istnienia rejestr wymaga: umowa, runbook ciągłości oraz
  // sam rejestr z instrukcją edycji. Brak któregokolwiek to nie jest usterka
  // kosmetyczna - to powrót do stanu sprzed naprawy.
  const requiredDocuments = [
    registry.kontraktUtrzymaniowy.dokument,
    registry.kontraktUtrzymaniowy.runbookCiaglosci,
    "governance/README.md",
  ];
  const documentExists: Record<string, boolean> = {};
  for (const path of requiredDocuments) documentExists[path] = existsSync(path);

  const report = analyzeOwnership({
    registry,
    routeFiles: readRouteFiles(),
    migrations: readMigrations(),
    documentExists,
    today: new Date().toISOString().slice(0, 10),
  });

  const rendered = renderOwnershipReport(report);
  if (ownershipFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
