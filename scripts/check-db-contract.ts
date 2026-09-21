// Read-only catalog verification: never execute domain RPCs to test their existence.
import { probeSchemaObjects } from "../src/lib/ci/deploymentProbe";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  contractFailed,
  extractExpectedContract,
  renderContractReport,
  type ContractReport,
} from "../src/lib/ci/dbContract";
import { MIGRATIONS_DIR, stripSqlComments } from "./lib/sqlMigrations";

const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
const key =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

/**
 * Obiekty świadomie wycofane - lista może TYLKO maleć.
 *
 * Historycznie mieszkały tu cztery obiekty generacji „expert_request": migracja
 * 20260723180000 przemianowywała `expert_inmails` -> `expert_requests`, ale
 * produkcja została przy starej nazwie (blok z RENAME nigdy się nie wykonał),
 * więc połowa tamtej generacji nie istniała nigdzie poza plikiem migracji.
 * 20260806160000 scala oba światy: jedna relacja fizyczna (`expert_inmails`)
 * i KOMPLET dziesięciu RPC (5 nazw wołanych przez klienta + 5 domenowych),
 * więc bramka może wymagać ich wszystkich - wpisy zniknęły.
 */
const SUPERSEDED = new Set<string>([]);

function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
}

async function main(): Promise<void> {
  if (!url || !key) {
    console.error("✗ Brak SUPABASE_URL / klucza Supabase - nie mogę zweryfikować kontraktu bazy.");
    throw new Error("Missing deployment database configuration");
  }

  const contract = extractExpectedContract(loadMigrations());
  const all = [...contract.tables, ...contract.views, ...contract.functions].filter(
    (o) => !SUPERSEDED.has(o.name),
  );
  const missing = await probeSchemaObjects(all, { url, key });
  const report: ContractReport = { checked: all.length, missing, inconclusive: [] };
  const markdown = renderContractReport(report);
  console.log(markdown);

  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/db-contract.json",
    `${JSON.stringify(
      {
        status: contractFailed(report) ? "failed" : "passed",
        checked: report.checked,
        missing: report.missing.map((o) => ({ kind: o.kind, name: o.name, file: o.file })),
        inconclusive: report.inconclusive.map((o) => ({ kind: o.kind, name: o.name })),
      },
      null,
      2,
    )}\n`,
  );

  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) writeFileSync(summary, `${markdown}\n`, { flag: "a" });

  if (contractFailed(report)) {
    console.error(`✗ Brakuje ${report.missing.length} obiektów w bazie po wdrożeniu.`);
    process.exit(1);
  }
  console.log(`✓ Kontrakt bazy spełniony (${report.checked} obiektów).`);
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "Database probe failed";
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/db-contract.json", JSON.stringify({ status: "failed", error: detail }));
  console.error(detail);
  process.exitCode = 1;
});
