/**
 * Bramka PO WDROŻENIU: czy wszystkie migracje z gałęzi faktycznie wykonały się
 * na bazie (Supabase).
 *
 * Uzupełnia `check:db-contract`. Tamta bramka sonduje obiekty (tabele, widoki,
 * RPC) i nie zauważy migracji, która niczego nie tworzy - ALTER, polityka RLS,
 * GRANT, `CREATE OR REPLACE`, seed. Tutaj porównujemy rejestr:
 * `supabase/migrations/<wersja>_*.sql` ⇄ `supabase_migrations.schema_migrations`.
 *
 * Rejestr siedzi poza schematem `public`, więc Data API go nie widzi. Pyta o
 * niego RPC `public.missing_migration_versions(text[])`: dostaje listę wersji
 * znanych CI i zwraca wyłącznie te, których w bazie brak - żadnej enumeracji
 * historii wdrożeń, więc klucz publikowalny wystarczy.
 *
 * Zakres bramki (bazowa linia + uzgodnienia) opisuje `supabase/migration-ledger.json`.
 *
 * Usage:
 *   bun run check:migration-ledger
 * Env: SUPABASE_URL (lub VITE_SUPABASE_URL) + SUPABASE_PUBLISHABLE_KEY
 *      (lub VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY).
 */
import { probeMigrationVersions } from "../src/lib/ci/deploymentProbe";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  buildLedgerReport,
  ledgerFailed,
  ledgerRequirements,
  parseMigrationFiles,
  renderLedgerReport,
  type LedgerConfig,
} from "../src/lib/ci/migrationLedger";
import { MIGRATIONS_DIR } from "./lib/sqlMigrations";

const CONFIG_PATH = "supabase/migration-ledger.json";

const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
const key =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

function loadConfig(): LedgerConfig {
  const raw: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (raw === null || typeof raw !== "object") {
    throw new Error(`${CONFIG_PATH}: oczekiwano obiektu JSON.`);
  }
  const parsed = raw as { baseline?: unknown; reconciled?: unknown };
  if (typeof parsed.baseline !== "string" || !/^\d{14}$/.test(parsed.baseline)) {
    throw new Error(`${CONFIG_PATH}: 'baseline' musi być 14-cyfrową wersją migracji.`);
  }
  const reconciled: Record<string, string> = {};
  if (parsed.reconciled !== undefined) {
    if (parsed.reconciled === null || typeof parsed.reconciled !== "object") {
      throw new Error(`${CONFIG_PATH}: 'reconciled' musi być mapą plik → wersja.`);
    }
    for (const [file, version] of Object.entries(parsed.reconciled as Record<string, unknown>)) {
      if (typeof version !== "string" || !/^\d{14}$/.test(version)) {
        throw new Error(`${CONFIG_PATH}: uzgodnienie '${file}' musi wskazywać 14-cyfrową wersję.`);
      }
      reconciled[file] = version;
    }
  }
  return { baseline: parsed.baseline, reconciled };
}

async function main(): Promise<void> {
  if (!url || !key) {
    console.error(
      "✗ Brak SUPABASE_URL / klucza Supabase - nie mogę zweryfikować rejestru migracji.",
    );
    throw new Error("Missing deployment database configuration");
  }

  const config = loadConfig();
  const { parsed, malformed } = parseMigrationFiles(readdirSync(MIGRATIONS_DIR));
  const askedVersions = [
    ...new Set(ledgerRequirements(parsed, config).map((r) => r.ledgerVersion)),
  ];
  const missingVersions = await probeMigrationVersions(askedVersions, { url, key });
  const report = buildLedgerReport(parsed, malformed, missingVersions, config);

  const markdown = renderLedgerReport(report);
  console.log(markdown);

  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/migration-ledger.json",
    `${JSON.stringify(
      {
        status: ledgerFailed(report) ? "failed" : "passed",
        baseline: config.baseline,
        required: report.required.length,
        baselined: report.baselined,
        missing: report.missing.map((m) => ({
          file: m.file,
          version: m.version,
          ledgerVersion: m.ledgerVersion,
        })),
        staleReconciliations: report.staleReconciliations,
        malformed: report.malformed,
      },
      null,
      2,
    )}\n`,
  );

  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) writeFileSync(summary, `${markdown}\n`, { flag: "a" });

  if (ledgerFailed(report)) {
    console.error(
      `✗ Wdrożenie niepełne: ${report.missing.length} migracji nie ma w rejestrze bazy` +
        (report.malformed.length > 0 ? `, ${report.malformed.length} plików ma złą nazwę` : "") +
        (report.staleReconciliations.length > 0
          ? `, ${report.staleReconciliations.length} martwych uzgodnień`
          : "") +
        ".",
    );
    process.exit(1);
  }
  console.log(
    `✓ Rejestr migracji zgodny (${report.required.length} egzekwowanych, ${report.baselined} poniżej bazowej linii).`,
  );
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "Migration probe failed";
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/migration-ledger.json",
    JSON.stringify({ status: "failed", error: detail }),
  );
  console.error(detail);
  process.exitCode = 1;
});
