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
 * Usage:
 *   bun run check:migration-ledger
 * Env: SUPABASE_URL (lub VITE_SUPABASE_URL) + SUPABASE_PUBLISHABLE_KEY
 *      (lub VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY).
 */
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import {
  buildLedgerReport,
  ledgerFailed,
  parseMigrationFiles,
  renderLedgerReport,
} from "../src/lib/ci/migrationLedger";
import { MIGRATIONS_DIR } from "./lib/sqlMigrations";

const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
const key =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

/** Rejestr bywa duży - pytamy partiami, żeby nie budować gigantycznego body. */
const BATCH = 200;

async function askMissing(versions: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (let i = 0; i < versions.length; i += BATCH) {
    const batch = versions.slice(i, i + BATCH);
    const res = await fetch(`${url}/rest/v1/rpc/missing_migration_versions`, {
      method: "POST",
      headers: {
        apikey: key as string,
        Authorization: `Bearer ${key as string}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _versions: batch }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `RPC missing_migration_versions zwróciło ${res.status}: ${text.slice(0, 400)}`,
      );
    }
    const parsed: unknown = text ? JSON.parse(text) : [];
    if (!Array.isArray(parsed)) {
      throw new Error("RPC missing_migration_versions zwróciło nieoczekiwany kształt odpowiedzi.");
    }
    for (const v of parsed) if (typeof v === "string") missing.push(v);
  }
  return missing;
}

async function main(): Promise<void> {
  if (!url || !key) {
    console.error(
      "✗ Brak SUPABASE_URL / klucza Supabase - nie mogę zweryfikować rejestru migracji.",
    );
    process.exit(1);
  }

  const { parsed, malformed } = parseMigrationFiles(readdirSync(MIGRATIONS_DIR));
  const missingVersions = await askMissing(parsed.map((m) => m.version));
  const report = buildLedgerReport(parsed, malformed, missingVersions);

  const markdown = renderLedgerReport(report);
  console.log(markdown);

  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/migration-ledger.json",
    `${JSON.stringify(
      {
        expected: report.expected.length,
        missing: report.missing.map((m) => ({ version: m.version, file: m.file })),
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
      `✗ Wdrożenie niepełne: ${report.missing.length} migracji nie wykonało się na bazie` +
        (report.malformed.length > 0 ? `, ${report.malformed.length} plików ma złą nazwę` : "") +
        ".",
    );
    process.exit(1);
  }
  console.log(`✓ Rejestr migracji zgodny (${report.expected.length} migracji).`);
}

void main();
