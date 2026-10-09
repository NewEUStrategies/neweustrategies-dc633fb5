// Read-only catalog verification: never execute domain RPCs to test their existence.
import { probeSchemaColumns, probeSchemaObjects } from "../src/lib/ci/deploymentProbe";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_COLUMN_DRIFT,
  columnDriftFailed,
  compareColumnDrift,
  contractFailed,
  dbColumnKey,
  expectedColumns,
  extractExpectedContract,
  inconclusiveColumnDrift,
  renderColumnDriftReport,
  renderContractReport,
  type ColumnDriftReport,
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

  const migrations = loadMigrations();
  const contract = extractExpectedContract(migrations);
  const all = [...contract.tables, ...contract.views, ...contract.functions].filter(
    (o) => !SUPERSEDED.has(o.name),
  );
  const missing = await probeSchemaObjects(all, { url, key });
  const report: ContractReport = { checked: all.length, missing, inconclusive: [] };

  // Kolumny tabel, których brakuje w całości, zgłasza już kontrakt obiektowy -
  // drugi raport o tym samym byłby szumem.
  const missingTables = new Set(missing.filter((o) => o.kind === "table").map((o) => o.name));
  const columns = expectedColumns(migrations, contract.tables).filter(
    (c) => !missingTables.has(c.table),
  );
  // Sonda kolumn stoi na RPC z 20261009110000. Gdy kontrakt obiektowy właśnie
  // wykazał jego brak, werdykt o kolumnach jest NIEMOŻLIWY - nie zielony.
  const columnReport: ColumnDriftReport = missing.some(
    (o) => o.kind === "function" && o.name === "missing_schema_columns",
  )
    ? inconclusiveColumnDrift(
        columns,
        "Na bazie nie ma RPC `missing_schema_columns` (migracja 20261009110000) - zastosuj ją i uruchom bramkę ponownie.",
      )
    : compareColumnDrift(
        columns,
        await probeSchemaColumns(columns, { url, key }),
        KNOWN_COLUMN_DRIFT,
      );

  const markdown = `${renderContractReport(report)}\n\n${renderColumnDriftReport(columnReport)}`;
  console.log(markdown);

  const objectsFailed = contractFailed(report);
  const columnsFailed = columnDriftFailed(columnReport);
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/db-contract.json",
    `${JSON.stringify(
      {
        status: objectsFailed || columnsFailed ? "failed" : "passed",
        checked: report.checked,
        missing: report.missing.map((o) => ({ kind: o.kind, name: o.name, file: o.file })),
        inconclusive: report.inconclusive.map((o) => ({ kind: o.kind, name: o.name })),
        columns: {
          status: columnsFailed ? "failed" : "passed",
          checked: columnReport.checked,
          missing: columnReport.missing.map((c) => ({ column: dbColumnKey(c), file: c.file })),
          known: columnReport.known.map(dbColumnKey),
          resolved: columnReport.resolved,
          inconclusive: columnReport.inconclusive,
        },
      },
      null,
      2,
    )}\n`,
  );

  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) writeFileSync(summary, `${markdown}\n`, { flag: "a" });

  if (objectsFailed)
    console.error(`✗ Brakuje ${report.missing.length} obiektów w bazie po wdrożeniu.`);
  if (columnsFailed) {
    console.error(
      `✗ Kontrakt kolumn: ${columnReport.missing.length} nowych braków, ` +
        `${columnReport.resolved.length} martwych wpisów rejestru` +
        (columnReport.inconclusive === null ? "." : " - sonda nie wykonana."),
    );
  }
  if (objectsFailed || columnsFailed) process.exit(1);
  console.log(
    `✓ Kontrakt bazy spełniony (${report.checked} obiektów, ${columnReport.checked} kolumn; ` +
      `znany dryf: ${columnReport.known.length}).`,
  );
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "Database probe failed";
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/db-contract.json", JSON.stringify({ status: "failed", error: detail }));
  console.error(detail);
  process.exitCode = 1;
});
